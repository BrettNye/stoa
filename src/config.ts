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
}

export function parseConfig(
  argv: string[],
  env: Record<string, string | undefined> = process.env
): VaultConfig {
  let vaultPath: string | undefined;
  let mcpMode = false;
  let defaultWiki: string | undefined;

  for (const arg of argv) {
    if (arg === "--mcp") mcpMode = true;
    else if (arg.startsWith("--vault=")) vaultPath = arg.slice("--vault=".length);
    else if (arg.startsWith("--default-wiki=")) defaultWiki = arg.slice("--default-wiki=".length);
  }

  if (!vaultPath) vaultPath = env.VAULT_PATH;

  if (!vaultPath) {
    throw new ConfigError(
      "vault path required: pass --vault=<path> or set VAULT_PATH"
    );
  }

  return { vaultPath, mcpMode, defaultWiki };
}
