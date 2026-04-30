import type { VaultConfig } from "../config.js";
import { buildCtx, type DispatchCtx } from "./stdio.js";

// Re-export so a future HTTP server uses the same ctx-construction contract as stdio
// (notably, ctx.fetcher must be populated — see stdio.ts and spec §7.4).
export { buildCtx };
export type { DispatchCtx };

export async function startHttp(_config: VaultConfig): Promise<void> {
  throw new Error("HTTP transport not implemented in v1; use --mcp (stdio) or run as CLI");
}
