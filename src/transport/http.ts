import type { VaultConfig } from "../config.js";

export async function startHttp(_config: VaultConfig): Promise<void> {
  throw new Error("HTTP transport not implemented in v1; use --mcp (stdio) or run as CLI");
}
