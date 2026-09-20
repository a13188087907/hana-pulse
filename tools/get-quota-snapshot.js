// Agent 可调用工具：返回最近一次各服务商额度读数（只读缓存，不触发网络请求）。
// 不 import @hana/plugin-runtime：dev 安装不复制 node_modules，裸 export 契约即可。
// 共享缓存经 execute 的第二个参数（插件上下文）上的 pluginStore 取得。

function formatReading(r) {
  if (r.status === "unconfigured") return `${r.name}：未配置凭据`;
  if (r.status === "auth_expired") return `${r.name}：凭据失效${r.error ? `（${r.error}）` : ""}`;
  if (r.status !== "ok") return `${r.name}：读取失败${r.error ? `（${r.error}）` : ""}`;

  const parts = [];
  for (const w of r.windows ?? []) {
    const remain = Math.round(100 - w.usedPercent);
    const reset = w.resetsAt ? `，${new Date(w.resetsAt).toLocaleString("zh-CN")} 重置` : "";
    parts.push(`${w.label} 剩 ${remain}%${reset}`);
  }
  for (const b of r.balances ?? []) {
    parts.push(`余额 ${b.amount} ${b.currency}`);
  }
  const plan = r.plan ? `（${r.plan}）` : "";
  return `${r.name}${plan}：${parts.join("；") || "暂无读数"}`;
}

export const name = "get_quota_snapshot";
export const description =
  "查看各 AI 服务商（Claude Code、Codex、Kimi、DeepSeek、智谱、z.ai、MiniMax 等）的最新订阅额度与 API 余额读数。数据来自插件缓存，不触发网络请求。";
export const parameters = {
  type: "object",
  properties: {
    providerId: {
      type: "string",
      description: "可选，只查某一家，如 codex、claude-code、deepseek、kimi、zhipu、zai、minimax",
    },
  },
};
export const sessionPermission = { readOnly: true };

export async function execute(input = {}, ctx) {
  const store = ctx?.pluginStore;
  if (!store) {
    return { content: [{ type: "text", text: "Pulse 插件尚未完成初始化，请稍后重试。" }] };
  }
  const readings = input.providerId
    ? store.getAll().filter((r) => r.providerId === input.providerId)
    : store.getAll();

  if (readings.length === 0) {
    return {
      content: [{
        type: "text",
        text: input.providerId
          ? `没有找到 ${input.providerId} 的读数，可能该服务商未配置凭据。`
          : "还没有任何额度读数。请在 Pulse 插件设置中配置 API key，或登录对应的 CLI 工具。",
      }],
    };
  }

  const lines = readings.map(formatReading);
  const header = store?.lastPollAt ? `更新于 ${new Date(store.lastPollAt).toLocaleString("zh-CN")}` : "尚未刷新";
  return { content: [{ type: "text", text: `${header}\n\n${lines.join("\n")}` }] };
}
