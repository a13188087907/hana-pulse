// 轮询调度：启动时立即刷一次，此后按配置间隔刷新。防重入。

import { PROVIDERS } from "../providers/index.js";
import { refreshAll } from "./engine.js";

export class Poller {
  constructor(ctx, store) {
    this.ctx = ctx;
    this.store = store;
    this.timer = null;
    this.running = false;
  }

  async intervalMinutes() {
    const value = await this.ctx.config.get("pollIntervalMinutes");
    const n = Number(value);
    return Number.isFinite(n) && n >= 1 ? Math.min(n, 60) : 5;
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await refreshAll(PROVIDERS, this.ctx, this.store);
    } catch (err) {
      this.ctx.log.warn("pulse poll failed", String(err?.message ?? err));
    } finally {
      this.running = false;
    }
  }

  async start() {
    // 首轮后台执行，不阻塞 onload：某家请求卡住不应拖住插件激活
    this.tick();
    const minutes = await this.intervalMinutes();
    this.timer = setInterval(() => this.tick(), minutes * 60 * 1000);
    if (typeof this.timer.unref === "function") this.timer.unref();
    this.ctx.log.info(`pulse poller started, interval ${minutes}min`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
