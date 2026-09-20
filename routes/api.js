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
}
