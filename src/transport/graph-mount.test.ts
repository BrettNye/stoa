import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startHttp } from "./http.js";

const SECRET = "test-secret-32-bytes-minimum-please-yes";

let serverInstance: Server | undefined;
let port: number;
let vault: string;

const MINIMAL_PAGES = {
  pages: [
    {
      id: "concept-foo",
      type: "concept",
      wiki: "test",
      title: "Foo concept",
      summary: "Foo.",
      tags: [],
      status: "active",
      updated: "2026-01-01",
      created: "2026-01-01",
      path: "wikis/test/concepts/concept-foo.md",
      tokens: { title: ["foo"], summary: ["foo"], body: [], tags: [] },
    },
  ],
};

const MINIMAL_LINKS = {
  "concept-foo": { outbound: [], inbound: [] },
};

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), "stoa-graph-mount-"));
  mkdirSync(join(vault, "wikis"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, "_index", "pages.json"), JSON.stringify(MINIMAL_PAGES));
  writeFileSync(join(vault, "_index", "links.json"), JSON.stringify(MINIMAL_LINKS));

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

describe("graph routes (public — no bearer required)", () => {
  it("GET /graph/data returns 200 with nodes and links WITHOUT a bearer token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/graph/data`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("nodes");
    expect(body).toHaveProperty("links");
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.links)).toBe(true);
  });

  it("GET /graph/themes returns 200 WITHOUT a bearer token", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/graph/themes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("themes");
  });

  it("/health and /mcp behavior is unchanged", async () => {
    // /health still public
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
    expect(healthRes.status).toBe(200);

    // /mcp still requires bearer
    const mcpRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(mcpRes.status).toBe(401);
  });

  // Static-serve for /graph is a smoke test only — dist/viewer may not exist
  // in CI. We assert /graph/data (the load-bearing route) above; here we only
  // check that the route doesn't crash if the viewer build is present.
  it("GET /graph does not return 500 (static-serve wired correctly)", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/graph`);
    // 200 (built viewer present) or 404 (dist/viewer not built yet) are both
    // acceptable — 500 would indicate the route handler itself threw.
    expect(res.status).not.toBe(500);
  });
});
