// UI 路由：widget 为自包含 HTML（无构建链、无外部资源依赖），直接读文件返回。

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetPath = join(__dirname, "..", "views", "widget.html");
let cachedHtml = null;

export default function registerPluginUiRoutes(app, ctx) {
  app.get("/widget", (c) => {
    if (!cachedHtml) cachedHtml = readFileSync(widgetPath, "utf-8");
    return c.html(cachedHtml);
  });
}
