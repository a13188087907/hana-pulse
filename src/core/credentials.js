// 凭据层：自动发现本机 CLI 凭据，或从插件配置读取用户填写的 API key。
// 原则：只读，绝不写凭据文件；token 刷新是各 CLI 自己的职责。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function expandHome(p) {
  if (typeof p !== "string") return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// 按描述解析凭据。返回 { token, accountId?, accountLabel?, expiresAt?, source, path? } 或 null。
export async function resolveCredential(desc, ctx) {
  if (!desc) return null;

  if (desc.type === "configKey") {
    const value = await ctx.config.get(desc.key);
    if (typeof value === "string" && value.trim()) {
      return { token: value.trim().replace(/[\r\n]+/g, ""), source: "config" };
    }
    return null;
  }

  if (desc.type === "cliFile") {
    const override = desc.configPathKey ? await ctx.config.get(desc.configPathKey) : null;
    const filePath = expandHome(
      typeof override === "string" && override.trim() ? override.trim() : desc.path
    );
    const json = readJsonSafe(filePath);
    if (!json) return null;
    const cred = desc.extract(json);
    if (!cred) return null;
    return { ...cred, source: "cli-file", path: filePath };
  }

  return null;
}

// 扫描所有 cliFile 型服务商，报告凭据文件是否存在、能否解析、是否过期。
// 供设置/诊断页展示，不触发网络请求。
export async function discoverCredentials(providers, ctx) {
  const results = [];
  for (const provider of providers) {
    const desc = provider.credential;
    if (desc?.type === "cliFile") {
      const filePath = expandHome(desc.path);
      const exists = fs.existsSync(filePath);
      let parsed = false;
      let expired = false;
      if (exists) {
        const json = readJsonSafe(filePath);
        const cred = json ? desc.extract(json) : null;
        parsed = Boolean(cred);
        expired = Boolean(cred?.expiresAt && cred.expiresAt < Date.now());
      }
      results.push({
        providerId: provider.id,
        name: provider.name,
        type: "cli-file",
        path: filePath,
        found: exists,
        parsed,
        expired,
      });
    } else if (desc?.type === "configKey") {
      const value = await ctx.config.get(desc.key);
      results.push({
        providerId: provider.id,
        name: provider.name,
        type: "config-key",
        configKey: desc.key,
        configured: typeof value === "string" && value.trim().length > 0,
      });
    }
  }
  return results;
}
