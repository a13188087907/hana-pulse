// 服务商声明式描述 + 解析器。
// 每家服务商回答五件事：凭据在哪、请求发哪、认证头怎么拼、响应取什么、窗口还是余额。
// 数据通路参照 Pulse (https://github.com/qunqin24/Pulse) 的各 UsageService 实现。

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

// z.ai / 智谱 GLM Coding 的 unit 字段 → 窗口分钟数（来自 Pulse 的 perUnit 映射）
const ZAI_UNIT_MINUTES = { 1: 1440, 3: 60, 5: 1, 6: 10080 };

function num(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function windowLabel(seconds) {
  if (!seconds) return "限额窗口";
  if (seconds >= 28 * DAY) return "月限额";
  if (seconds >= 7 * DAY) return "周限额";
  if (seconds >= DAY) return "日限额";
  if (seconds >= HOUR) return `${Math.round(seconds / HOUR)} 小时窗口`;
  return `${Math.round(seconds / MINUTE)} 分钟窗口`;
}

function glmProvider({ id, name, host }) {
  return {
    id,
    name,
    kind: "window",
    credential: { type: "configKey", key: `${id}ApiKey` },
    request: (cred) => ({
      url: `${host}/api/monitor/usage/quota/limit`,
      headers: { Authorization: `Bearer ${cred.token}`, Accept: "application/json" },
    }),
    parse(json) {
      const data = json?.data ?? json;
      const limits = Array.isArray(data?.limits) ? data.limits : [];
      const windows = [];
      for (const limit of limits) {
        const used = num(limit?.percentage);
        if (used == null) continue;
        const unitMin = ZAI_UNIT_MINUTES[num(limit?.unit)] ?? null;
        const count = num(limit?.number) ?? 1;
        const seconds = unitMin ? unitMin * count * MINUTE : null;
        const resetRaw = limit?.next_reset_time ?? limit?.nextResetTime ?? limit?.reset_time ?? null;
        const resetMs = num(resetRaw);
        windows.push({
          id: `${id}.${limit?.type ?? windows.length}`,
          label: limit?.type === "TIME_LIMIT" ? "时间额度" : windowLabel(seconds),
          usedPercent: Math.min(Math.max(used, 0), 100),
          resetsAt: resetMs ? new Date(resetMs).toISOString() : null,
          windowSeconds: seconds,
        });
      }
      return {
        plan: data?.planName ?? data?.plan ?? data?.level ?? null,
        windows,
      };
    },
  };
}

function minimaxProvider({ id, name, host }) {
  return {
    id,
    name,
    kind: "window",
    credential: { type: "configKey", key: `${id}ApiKey` },
    request: (cred) => ({
      url: `${host}/v1/token_plan/remains`,
      headers: { Authorization: `Bearer ${cred.token}`, Accept: "application/json" },
    }),
    authError(json) {
      const base = json?.base_resp;
      if (base && num(base.status_code) === 1004) return "凭据失效，请重新填写 API key";
      if (base && num(base.status_code) !== 0) return base.status_msg || `服务商错误 ${base.status_code}`;
      return null;
    },
    parse(json) {
      const payload = json?.data ?? json;
      const models = Array.isArray(payload?.model_remains) ? payload.model_remains : [];
      const windows = [];
      for (const model of models) {
        const nameKey = typeof model?.model_name === "string" ? model.model_name : "";
        const total = num(model?.current_interval_total_count) ?? num(model?.total_count);
        const left = num(model?.current_interval_remains_count) ?? num(model?.remains_count);
        let usedPercent = null;
        if (total && left != null && total > 0) usedPercent = ((total - left) / total) * 100;
        const percentRemaining = num(model?.remains_percentage);
        if (usedPercent == null && percentRemaining != null) usedPercent = 100 - percentRemaining;
        if (usedPercent == null) continue;
        const startMs = num(model?.start_time);
        const endMs = num(model?.end_time);
        windows.push({
          id: `${id}.${nameKey || windows.length}`,
          label: nameKey && nameKey.toLowerCase() !== "general" ? nameKey : "token 套餐",
          usedPercent: Math.min(Math.max(usedPercent, 0), 100),
          resetsAt: endMs ? new Date(endMs).toISOString() : null,
          windowSeconds: startMs && endMs ? Math.round((endMs - startMs) / 1000) : null,
        });
      }
      return { windows };
    },
  };
}

export const PROVIDERS = [
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "window",
    credential: {
      type: "cliFile",
      path: "~/.claude/.credentials.json",
      extract(json) {
        const oauth = json?.claudeAiOauth;
        if (!oauth?.accessToken) return null;
        return {
          token: oauth.accessToken,
          expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
          accountLabel: oauth.subscriptionType ?? null,
        };
      },
    },
    request: (cred) => ({
      url: "https://api.anthropic.com/api/oauth/usage",
      headers: {
        Authorization: `Bearer ${cred.token}`,
        "anthropic-beta": "oauth-2025-04-20",
        Accept: "application/json",
      },
    }),
    parse(json, cred) {
      const windows = [];
      const known = [
        ["five_hour", "5 小时窗口", 5 * HOUR],
        ["seven_day", "周限额", 7 * DAY],
      ];
      for (const [key, label, seconds] of known) {
        const node = json?.[key];
        const used = num(node?.utilization);
        if (used == null) continue;
        windows.push({
          id: `claude-code.${key}`,
          label,
          usedPercent: Math.min(Math.max(used, 0), 100),
          resetsAt: typeof node?.resets_at === "string" ? node.resets_at : null,
          windowSeconds: seconds,
        });
      }
      return { plan: cred.accountLabel, windows };
    },
  },

  {
    id: "codex",
    name: "Codex",
    kind: "window",
    credential: {
      type: "cliFile",
      path: "~/.codex/auth.json",
      extract(json) {
        const tokens = json?.tokens;
        if (!tokens?.access_token) return null;
        return { token: tokens.access_token, accountId: tokens.account_id ?? null };
      },
    },
    request: (cred) => ({
      url: "https://chatgpt.com/backend-api/wham/usage",
      headers: {
        Authorization: `Bearer ${cred.token}`,
        Accept: "application/json",
        ...(cred.accountId ? { "ChatGPT-Account-Id": cred.accountId } : {}),
      },
    }),
    parse(json) {
      const limit = json?.rate_limit ?? {};
      const windows = [];
      const slots = [
        ["primary_window", "5 小时窗口", 5 * HOUR],
        ["secondary_window", "周限额", 7 * DAY],
      ];
      for (const [slot, fallbackLabel, fallbackSeconds] of slots) {
        const node = limit[slot];
        const used = num(node?.used_percent);
        if (used == null) continue;
        const seconds = num(node?.limit_window_seconds) ?? fallbackSeconds;
        const resetAt = num(node?.reset_at);
        windows.push({
          id: `codex.${slot}`,
          label: windowLabel(seconds) === "限额窗口" ? fallbackLabel : windowLabel(seconds),
          usedPercent: Math.min(Math.max(used, 0), 100),
          resetsAt: resetAt ? new Date(resetAt * 1000).toISOString() : null,
          windowSeconds: seconds,
        });
      }
      const planKey = typeof json?.plan_type === "string" ? json.plan_type.toLowerCase() : null;
      const planNames = { free: "Free", go: "Go", plus: "Plus", pro: "Pro", prolite: "Pro 5x", team: "Team" };
      return { plan: planNames[planKey] ?? planKey, windows };
    },
  },

  {
    id: "kimi",
    name: "Kimi",
    kind: "window",
    credential: { type: "configKey", key: "kimiApiKey" },
    request: (cred) => ({
      url: "https://api.kimi.com/coding/v1/usages",
      headers: {
        Authorization: `Bearer ${cred.token}`,
        Accept: "application/json",
        // Kimi Code 控制台（api.kimi.com/coding）的 key 与开放平台不通用；UA 来自
        // 第三方实测项目 kimi-code-usage，缺失可能被拦
        "User-Agent": "KimiCLI/1.6",
      },
    }),
    // 响应形态有多种（ Pulse 的 details[] 、 kimi-code-usage 的 data[] 与 usage+limits[] ），
    // 逐形态尝试，字段全部宽容取值
    parse(json) {
      const windows = [];
      const pickRow = (item, label, seconds, i) => {
        if (!item || typeof item !== "object") return;
        const limit = num(item.limit) ?? num(item.limit_amount);
        let used = num(item.used) ?? num(item.used_amount);
        const remaining = num(item.remaining);
        if (used == null && remaining != null && limit != null) used = limit - remaining;
        if (!limit || used == null) return;
        const resetRaw = item.resetTime ?? item.reset_at ?? item.reset_time ?? item.resetAt ?? null;
        const resetMs = typeof resetRaw === "number" ? (resetRaw > 1e12 ? resetRaw : resetRaw * 1000) : null;
        windows.push({
          id: `kimi.${i}`,
          label: typeof (item.name ?? item.title) === "string" ? (item.name ?? item.title) : label,
          usedPercent: Math.min(Math.max((used / limit) * 100, 0), 100),
          resetsAt: typeof resetRaw === "string" ? resetRaw : resetMs ? new Date(resetMs).toISOString() : null,
          windowSeconds: seconds,
        });
      };
      const winSeconds = (win) => {
        const duration = num(win?.duration);
        const unit = String(win?.timeUnit ?? win?.time_unit ?? "").toLowerCase();
        if (!duration) return null;
        if (unit.startsWith("month")) return 30 * DAY;
        if (unit.startsWith("day")) return duration * DAY;
        if (unit.startsWith("hour")) return duration * HOUR;
        return duration * MINUTE;
      };

      if (Array.isArray(json?.data)) {
        json.data.forEach((item, i) =>
          pickRow(item, item?.model_name === "all" ? "周用量" : "限额", null, i));
      }
      if (windows.length === 0 && (json?.usage || Array.isArray(json?.limits))) {
        pickRow(json.usage, "周用量", null, "summary");
        (Array.isArray(json?.limits) ? json.limits : []).forEach((item, i) => {
          const detail = item?.detail && typeof item.detail === "object" ? item.detail : item;
          pickRow(detail, windowLabel(winSeconds(item?.window)), winSeconds(item?.window), i);
        });
      }
      if (windows.length === 0 && Array.isArray(json?.details)) {
        json.details.forEach((d, i) => {
          const seconds = Array.isArray(json?.windows) ? winSeconds(json.windows[i]) : null;
          pickRow(d, seconds ? windowLabel(seconds) : "限额窗口", seconds, i);
        });
      }
      return { plan: json?.user?.membership?.level ?? null, windows };
    },
  },

  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "balance",
    credential: { type: "configKey", key: "deepseekApiKey" },
    request: (cred) => ({
      url: "https://api.deepseek.com/user/balance",
      headers: { Authorization: `Bearer ${cred.token}`, Accept: "application/json" },
    }),
    parse(json) {
      const infos = Array.isArray(json?.balance_infos) ? json.balance_infos : [];
      const balances = infos.map((info) => ({
        label: "可用余额",
        currency: info?.currency ?? "CNY",
        amount: num(info?.total_balance),
      })).filter((b) => b.amount != null);
      return { balances };
    },
  },

  glmProvider({ id: "zhipu", name: "智谱", host: "https://open.bigmodel.cn" }),
  glmProvider({ id: "zai", name: "z.ai", host: "https://api.z.ai" }),

  minimaxProvider({ id: "minimax", name: "MiniMax", host: "https://api.minimaxi.com" }),
  minimaxProvider({ id: "minimax-intl", name: "MiniMax 国际", host: "https://api.minimax.io" }),
];

export const PROVIDER_BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));
