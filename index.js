// 注意：不 import @hana/plugin-runtime。dev 安装流程不复制 node_modules，
// Node 侧代码必须零运行时依赖；SDK 包只参与 UI 的构建期打包。
import { QuotaStore } from "./src/core/store.js";
import { Poller } from "./src/core/poller.js";

let poller = null;

export default class PulsePlugin {
  // class 形式：宿主单例化插件并把共享上下文注入 this.ctx，
  // tools / routes 拿到的才是同一个上下文对象（与社区插件同一约定）。
  async onload() {
    const ctx = this.ctx;
    const store = new QuotaStore();
    store.init(ctx.dataDir);
    ctx.pluginStore = store;
    poller = new Poller(ctx, store);
    await poller.start();
    ctx.log.info("Pulse loaded");
  }

  async onunload() {
    poller?.stop();
    poller = null;
    this.ctx?.log?.info?.("Pulse unloaded");
  }
}
