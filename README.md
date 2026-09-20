# Pulse · Hana 额度监视器

HanaAgent 侧边栏插件：把各 AI 服务商的订阅限额与 API 余额拉到同一个面板里，一屏看全。

灵感与数据通路来自 macOS 应用 [Pulse](https://github.com/qunqin24/Pulse)（Apache 2.0）。原项目证明了"额度监控"的核心不是 UI，而是一张**本机凭据 → 服务商官方用量接口**的映射表；本插件在 Hana 插件体系里重建了这张表。

## 它做什么

- **侧边栏卡片面板**：每家服务商一张卡。订阅制显示剩余额度百分比与重置倒计时，按量付费显示账户余额。正常时灰阶安静，越过阈值才出现颜色（75% 琥珀 / 90% 深红，可调）
- **凭据自动发现**：登录过 Claude Code / Codex CLI 即自动接管本机凭据，无需任何配置
- **只读缓存**：后台每 5 分钟（可调）轮询一次落缓存，面板与 Agent 只读缓存，高频访问零网络代价
- **Agent 可感知**：提供 `get_quota_snapshot` 工具，对话里可以直接问 Agent"我各家额度还够吗"
- **诊断页**：凭据发现状态、每家最近读数、失败原因与恢复指引

## 数据安全

- 只发起去往服务商官方域名的请求，域名在 manifest 的 `network.allowedHosts` 白名单中全部列出
- 插件没有自己的服务器，不回传任何数据
- **只读凭据，绝不写入**：token 刷新是各 CLI 自己的职责。凭据过期时插件显示"重新登录后自动恢复"，而不是自己碰 refresh token
- API key 经 Hana 插件配置系统存储（密码字段），不进前端代码、不进仓库

## 支持的服务商

| 服务商 | 类型 | 凭据来源 |
| --- | --- | --- |
| Claude Code | 订阅窗口 | 本机 `~/.claude/.credentials.json`（自动发现） |
| Codex | 订阅窗口 | 本机 `~/.codex/auth.json`（自动发现） |
| Kimi Code | 订阅窗口 | 插件配置 API key |
| DeepSeek | API 余额 | 插件配置 API key |
| 智谱 GLM Coding | 订阅窗口 | 插件配置 API key |
| z.ai | 订阅窗口 | 插件配置 API key |
| MiniMax（国内/国际） | token 套餐 | 插件配置 API key |

## 安装

1. 克隆本仓库，进入目录执行 `npm install && npm run build:ui`
2. 在 Hana 设置中开启「允许 Agent 插件开发工具」
3. 让 Agent 安装：「把 D:\path\to\pulse 安装为开发插件」，或将整个目录放入 Hana 用户插件目录（`%USERPROFILE%\.hanako\plugins\pulse`）
4. 启用后，侧边栏出现「额度总览」，页面列表出现「额度诊断」

配置 API key：Hana 设置 → 插件 → Pulse，按需填写对应服务商的 key。

## 架构

```
ui/Panel.tsx          React 面板（卡片列表 + 诊断页），只读缓存
routes/ui.js          iframe 壳
routes/api.js         /api/snapshot /api/refresh /api/discovery
tools/                Agent 工具（只读）
src/
  providers/index.js  服务商声明式描述：凭据在哪、请求发哪、怎么解析
  core/engine.js      引擎：执行描述，归一化读数，单家失败不传染
  core/credentials.js 凭据层：CLI 文件自动发现 + 插件配置
  core/store.js       读数缓存（内存 + 磁盘）
  core/poller.js      后台轮询
```

加一家新服务商 = 在 `src/providers/index.js` 加一份声明式描述，不动引擎。

### 给 Hana 插件开发者的三个备注

这个仓库同时可作为非平凡 Hana 插件的参考实现，几处与文档直觉不同的实测结论：

1. **dev 安装不复制 `node_modules`**：Node 侧代码（index.js / routes / tools）必须零外部依赖，`@hana/plugin-runtime` 的 helper 只在 UI 构建期使用
2. **lifecycle / routes / tools 不共享模块单例**：共享状态要挂在 `this.ctx` 上（class 形式插件，`ctx.pluginStore = ...`），经 `execute(input, ctx)` 的第二参数取得
3. **插件入口用 class 形式**：`export default class { async onload() { const ctx = this.ctx; ... } }`，裸对象形式的 ctx 与 tools 上下文不互通

## Roadmap

- 更多服务商（GitHub Copilot、火山引擎、Cursor 等，按凭据类型分批）
- 越线提醒（toast，每家每次越线只说一次）
- 余额消耗速率与耗尽预测
- 紧凑模式与「仅看异常」过滤

## 致谢

- [Pulse](https://github.com/qunqin24/Pulse)：各服务商用量接口的读取方式全部来自该项目的源码调研
- [HanaAgent](https://github.com/liliMozi/openhanako)：插件宿主平台

## License

MIT
