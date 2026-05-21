import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startHttp } from "./http.js";

const SECRET = "test-secret-32-bytes-minimum-please-yes";
let serverInstance: Server | undefined;
let port: number;
let vault: string;

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), "stoa-http-"));
  // Minimal vault structure — accessSync(R_OK) on the path is what /health
  // checks, and the tmp dir already satisfies that. Create wikis/ so any
  // downstream resolution that walks the tree finds an empty but valid root.
  mkdirSync(join(vault, "wikis"), { recursive: true });
  process.env.STOA_TOKEN_SIGNING_SECRET = SECRET;
  serverInstance = (await startHttp(
    { vaultPath: vault, mcpMode: false } as any,
    { bindOverride: "127.0.0.1:0" },
  )) as Server;
  // Wait for the listening callback to fire so address() is populated.
  await new Promise<void>((resolve) => {
    if (serverInstance!.listening) return resolve();
    serverInstance!.once("listening", () => resolve());
  });
  const addr = serverInstance!.address() as AddressInfo;
  port = addr.port;
});

afterAll(async () => {
  if (serverInstance) {
    await new Promise<void>((resolve) => serverInstance!.close(() => resolve()));
  }
  rmSync(vault, { recursive: true, force: true });
  delete process.env.STOA_TOKEN_SIGNING_SECRET;
});

describe("HTTP transport", () => {
  it("/health returns 200 when vault path is readable", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("ok");
    expect(body.vault).toBe(vault);
    expect(typeof body.version).toBe("string");
  });

  it("/mcp returns 401 without bearer", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
  });

  it("/mcp returns 401 with invalid bearer", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        Authorization: "Bearer invalid",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/invalid_token/);
  });
});

describe("startHttp configuration", () => {
  it("throws when signing secret env var is unset", async () => {
    const tmpVault = mkdtempSync(join(tmpdir(), "stoa-http-nosec-"));
    const saved = process.env.STOA_TOKEN_SIGNING_SECRET;
    delete process.env.STOA_TOKEN_SIGNING_SECRET;
    try {
      await expect(
        startHttp({ vaultPath: tmpVault, mcpMode: false } as any, { bindOverride: "127.0.0.1:0" }),
      ).rejects.toThrow(/STOA_TOKEN_SIGNING_SECRET/);
    } finally {
      if (saved !== undefined) process.env.STOA_TOKEN_SIGNING_SECRET = saved;
      rmSync(tmpVault, { recursive: true, force: true });
    }
  });
});
