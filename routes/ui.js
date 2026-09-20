// UI 路由：widget 为自包含 HTML（无构建链、无外部资源依赖），直接读文件返回。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetPath = join(__dirname, "..", "views", "widget.html");

export default function registerPluginUiRoutes(app, ctx) {
  app.get("/widget", (c) => {
    // 每次读文件：面板上的“重试”按钮即成为热重载，改 HTML 不必重启宿主
    return c.html(readFileSync(widgetPath, "utf-8"));
  });
}
