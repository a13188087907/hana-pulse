// 适配器引擎：执行服务商描述，把各家响应归一化为 ProviderReading。
//
// ProviderReading 结构：
// {
//   providerId, name, kind: "window" | "balance",
//   status: "ok" | "unconfigured" | "auth_expired" | "fetch_failed" | "parse_failed",
//   updatedAt: ISO 时间,
//   plan, accountLabel, source: "cli-file" | "config",
//   windows: [{ id, label, usedPercent, resetsAt, windowSeconds }],
//   balances: [{ label, currency, amount }],
//   error: 人类可读的失败原因
// }

import { resolveCredential } from "./credentials.js";

export async function fetchProvider(provider, ctx) {
  const base = {
    providerId: provider.id,
    name: provider.name,
    kind: provider.kind,
    updatedAt: new Date().toISOString(),
  };

  let cred = null;
  try {
    cred = await resolveCredential(provider.credential, ctx);
  } catch (err) {
    return {
      ...base,
      status: "fetch_failed",
      error: `凭据读取异常：${err?.message ?? err}`,
      windows: [],
      balances: [],
    };
  }
  if (!cred) {
    return { ...base, status: "unconfigured", windows: [], balances: [] };
  }

  if (cred.expiresAt && cred.expiresAt < Date.now()) {
    return {
      ...base,
      status: "auth_expired",
      error: "凭据已过期，请在对应 CLI 重新登录",
      source: cred.source,
      windows: [],
      balances: [],
    };
  }

  const { url, headers } = provider.request(cred);

  let response;
  try {
    response = await ctx.network.fetch(url, { method: "GET", headers, timeoutMs: 15000 });
  } catch (err) {
    return {
      ...base,
      status: "fetch_failed",
      error: `网络请求失败：${err?.message ?? err}`,
      source: cred.source,
      windows: [],
      balances: [],
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      ...base,
      status: "auth_expired",
      error: "凭据被拒绝（401/403），请重新登录或检查 API key",
      source: cred.source,
      windows: [],
      balances: [],
    };
  }
  if (!response.ok) {
    return {
      ...base,
      status: "fetch_failed",
      error: `服务商返回 HTTP ${response.status}`,
      source: cred.source,
      windows: [],
      balances: [],
    };
  }

  let json;
  try {
    json = await response.json();
  } catch {
    return {
      ...base,
      status: "parse_failed",
      error: "响应不是合法 JSON",
      source: cred.source,
      windows: [],
      balances: [],
    };
  }

  if (typeof provider.authError === "function") {
    const authError = provider.authError(json);
    if (authError) {
      return { ...base, status: "auth_expired", error: authError, source: cred.source, windows: [], balances: [] };
    }
  }

  try {
    const parsed = provider.parse(json, cred) ?? {};
    return {
      ...base,
      status: "ok",
      source: cred.source,
      plan: parsed.plan ?? null,
      accountLabel: parsed.accountLabel ?? null,
      windows: parsed.windows ?? [],
      balances: parsed.balances ?? [],
    };
  } catch (err) {
    return {
      ...base,
      status: "parse_failed",
      error: `响应解析失败：${err?.message ?? err}`,
      source: cred.source,
      windows: [],
      balances: [],
    };
  }
}

// 顺序刷新全部服务商。串行而非并发：避免对同一服务商的多窗口端点形成突发。
// 每家独立容错：单家抛错只记为该行失败，不中断其他家的读取。
export async function refreshAll(providers, ctx, store) {
  for (const provider of providers) {
    let reading;
    try {
      reading = await fetchProvider(provider, ctx);
    } catch (err) {
      reading = {
        providerId: provider.id,
        name: provider.name,
        kind: provider.kind,
        status: "fetch_failed",
        updatedAt: new Date().toISOString(),
        error: `未捕获异常：${err?.message ?? err}`,
        windows: [],
        balances: [],
      };
    }
    ctx.log?.info?.(`pulse: ${provider.id} -> ${reading.status}`);
    store.set(reading);
  }
  store.lastPollAt = new Date().toISOString();
  store.persist();
  return store.getAll();
}
