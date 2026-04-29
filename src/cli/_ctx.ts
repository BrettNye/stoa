import type { VaultConfig } from "../config.js";

let _ctx: VaultConfig | null = null;

export function setCtx(ctx: VaultConfig): void { _ctx = ctx; }

export function getCtx(): VaultConfig {
  if (!_ctx) throw new Error("CLI context not initialized — call setCtx() in bin.ts before dispatch");
  return _ctx;
}
