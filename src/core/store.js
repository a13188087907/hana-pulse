// 读数缓存：内存 Map + dataDir 磁盘持久化。
// UI 和 Agent 工具只读缓存，刷新由 poller 负责，高频访问零网络代价。

import fs from "node:fs";
import path from "node:path";

const SNAPSHOT_FILE = "snapshot.json";

export class QuotaStore {
  constructor() {
    this.readings = new Map();
    this.lastPollAt = null;
    this.dataDir = null;
  }

  init(dataDir) {
    this.dataDir = dataDir;
    this.restore();
  }

  set(reading) {
    this.readings.set(reading.providerId, reading);
    this.persist();
  }

  getAll() {
    return Array.from(this.readings.values());
  }

  get(providerId) {
    return this.readings.get(providerId) ?? null;
  }

  snapshotFile() {
    return this.dataDir ? path.join(this.dataDir, SNAPSHOT_FILE) : null;
  }

  persist() {
    const file = this.snapshotFile();
    if (!file) return;
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const payload = JSON.stringify({ lastPollAt: this.lastPollAt, readings: this.getAll() });
      fs.writeFileSync(file, payload, "utf-8");
    } catch {
      // 持久化失败不影响内存态
    }
  }

  restore() {
    const file = this.snapshotFile();
    if (!file || !fs.existsSync(file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (Array.isArray(parsed?.readings)) {
        for (const r of parsed.readings) {
          if (r?.providerId) this.readings.set(r.providerId, r);
        }
      }
      if (typeof parsed?.lastPollAt === "string") this.lastPollAt = parsed.lastPollAt;
    } catch {
      // 损坏的缓存直接忽略，下次刷新重建
    }
  }
}

// 注意：不做模块级单例。Hana 的 lifecycle / routes / tools 运行在不同的模块上下文，
// 单例不互通。共享实例由 index.js 挂到 ctx.pluginStore（与社区插件同一约定）。
