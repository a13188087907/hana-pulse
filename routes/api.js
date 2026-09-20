// 数据 API：UI 面板只读缓存；手动刷新走 /api/refresh 立即触发。

import { PROVIDERS } from "../src/providers/index.js";
import { discoverCredentials } from "../src/core/credentials.js";
import { refreshAll } from "../src/core/engine.js";

async function thresholds(ctx) {
  const warn = Number(await ctx.config.get("warnThreshold"));
  const critical = Number(await ctx.config.get("criticalThreshold"));
  return {
    warn: Number.isFinite(warn) && warn > 0 ? warn : 75,
    critical: Number.isFinite(critical) && critical > 0 ? critical : 90,
  };
}

// 可通过面板写入的配置 key 白名单：仅服务商的 API key 字段，防止任意写配置
const WRITABLE_KEYS = new Set(
  PROVIDERS.filter((p) => p.credential?.type === "configKey").map((p) => p.credential.key)
);

export default function registerPluginApiRoutes(app, ctx) {
  app.get("/api/snapshot", async (c) => {
    const store = ctx.pluginStore;
    const t = await thresholds(ctx);
    return c.json({
      readings: store?.getAll() ?? [],
      lastPollAt: store?.lastPollAt ?? null,
      thresholds: t,
      providers: PROVIDERS.map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    });
  });

  app.get("/api/discovery", async (c) => {
    return c.json({ discovery: await discoverCredentials(PROVIDERS, ctx) });
  });

  app.post("/api/refresh", async (c) => {
    if (!ctx.pluginStore) return c.json({ ok: false, error: "未初始化" });
    const readings = await refreshAll(PROVIDERS, ctx, ctx.pluginStore);
    const t = await thresholds(ctx);
    return c.json({ ok: true, readings, lastPollAt: ctx.pluginStore.lastPollAt, thresholds: t });
  });

  // 面板内保存/清除 API key。空值即清除。保存后立即全量刷新，让新配置的服务商马上上卡。
  app.post("/api/credentials", async (c) => {
    if (!ctx.pluginStore) return c.json({ ok: false, error: "未初始化" });
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "请求格式错误" });
    }
    const key = typeof body?.key === "string" ? body.key : "";
    if (!WRITABLE_KEYS.has(key)) {
      return c.json({ ok: false, error: "不允许的配置项" });
    }
    const value = typeof body?.value === "string" ? body.value.trim() : "";
    try {
      await ctx.config.set(key, value || null);
    } catch (err) {
      return c.json({ ok: false, error: `保存失败：${err?.message ?? err}` });
    }
    const readings = await refreshAll(PROVIDERS, ctx, ctx.pluginStore);
    const t = await thresholds(ctx);
    return c.json({ ok: true, readings, lastPollAt: ctx.pluginStore.lastPollAt, thresholds: t });
  });
}
