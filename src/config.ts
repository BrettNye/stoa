import { resolve } from "node:path";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface VaultConfig {
  vaultPath: string;
  mcpMode: boolean;
  defaultWiki?: string;
  // v1.6 Phase 2 T3-6 — symmetric to defaultWiki. Captured from
  // `--default-family=<name>` and threaded through buildCtx into ctx.defaultFamily,
  // where `core/family.resolveFamily` consults it.
  defaultFamily?: string;
}

export function parseConfig(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): VaultConfig {
  let vaultPath: string | undefined;
  let mcpMode = false;
  let defaultWiki: string | undefined;
  let defaultFamily: string | undefined;

  for (const arg of argv) {
    if (arg === "--mcp") mcpMode = true;
    else if (arg.startsWith("--vault=")) vaultPath = arg.slice("--vault=".length);
    else if (arg.startsWith("--default-wiki=")) defaultWiki = arg.slice("--default-wiki=".length);
    else if (arg.startsWith("--default-family=")) defaultFamily = arg.slice("--default-family=".length);
  }

  if (!vaultPath) vaultPath = env.VAULT_PATH;

  if (!vaultPath) {
    throw new ConfigError(
      "vault path required: pass --vault=<path> or set VAULT_PATH"
    );
  }

  vaultPath = resolve(vaultPath);

  return { vaultPath, mcpMode, defaultWiki, defaultFamily };
}
