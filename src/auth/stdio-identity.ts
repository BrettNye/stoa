import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { userInfo } from "node:os";
import type { Principal } from "./types.js";

export interface StdioIdentityOptions {
  vaultPath: string;
  cliAgentId?: string;
}

export function resolveStdioIdentity(opts: StdioIdentityOptions): Principal {
  const agent_id =
    opts.cliAgentId ??
    process.env.STOA_AGENT_ID ??
    readVaultIdentity(opts.vaultPath) ??
    sanitize(userInfo().username) ??
    "stoa-local";
  return { agent_id, scopes: ["*:*"], source: "stdio" };
}

function readVaultIdentity(vaultPath: string): string | undefined {
  const path = join(vaultPath, ".stoa", "identity");
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return typeof raw.default_agent_id === "string" ? raw.default_agent_id : undefined;
  } catch {
    return undefined;
  }
}

function sanitize(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const clean = s.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  return clean || undefined;
}
