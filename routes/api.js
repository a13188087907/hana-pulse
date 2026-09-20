// 数据 API：UI 面板只读缓存；手动刷新走 /api/refresh 立即触发。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id));

// 按用户自定义顺序重排读数。未在 order 里的保持原相对顺序排后（JS sort 稳定）。
function applyOrder(readings, order) {
  if (!Array.isArray(order) || order.length === 0) return readings;
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...readings].sort((a, b) => {
    const ra = rank.has(a.providerId) ? rank.get(a.providerId) : order.length;
    const rb = rank.has(b.providerId) ? rank.get(b.providerId) : order.length;
    return ra - rb;
  });
}

// 卡片顺序存 dataDir 文件而非 ctx.config：配置系统只接受 manifest schema 里声明过的
// 字段，未声明的 key 会被静默丢弃（实测确认，cardOrder 曾因此不落盘）。
function orderFile(ctx) {
  return join(ctx.dataDir, "card-order.json");
}

async function cardOrder(ctx) {
  try {
    const raw = JSON.parse(readFileSync(orderFile(ctx), "utf-8"));
    return Array.isArray(raw?.order) ? raw.order.filter((id) => PROVIDER_IDS.has(id)) : [];
  } catch {
    return [];
  }
}

export default function registerPluginApiRoutes(app, ctx) {
  app.get("/api/snapshot", async (c) => {
    const store = ctx.pluginStore;
    const t = await thresholds(ctx);
    return c.json({
      readings: applyOrder(store?.getAll() ?? [], await cardOrder(ctx)),
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
    return c.json({ ok: true, readings: applyOrder(readings, await cardOrder(ctx)), lastPollAt: ctx.pluginStore.lastPollAt, thresholds: t });
  });

  // 保存卡片自定义排序（拖拽后调用）
  app.post("/api/order", async (c) => {
    let body;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "请求格式错误" });
    }
    const order = Array.isArray(body?.order) ? body.order.filter((id) => PROVIDER_IDS.has(id)) : null;
    if (!order) return c.json({ ok: false, error: "order 必须是数组" });
    try {
      mkdirSync(ctx.dataDir, { recursive: true });
      writeFileSync(orderFile(ctx), JSON.stringify({ order, updatedAt: new Date().toISOString() }), "utf-8");
    } catch (err) {
      return c.json({ ok: false, error: `保存失败：${err?.message ?? err}` });
    }
    return c.json({ ok: true });
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
