import { accessSync, constants } from "node:fs";
import type { Context } from "hono";

export function healthHandler(opts: { vaultPath: string; version: string }) {
  return (c: Context) => {
    try {
      accessSync(opts.vaultPath, constants.R_OK);
      return c.json({ status: "ok", vault: opts.vaultPath, version: opts.version });
    } catch {
      return c.json({ status: "unhealthy", vault: opts.vaultPath }, 503);
    }
  };
}
