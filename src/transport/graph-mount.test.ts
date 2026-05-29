import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startUiServer, type UiServerHandle } from "./ui/index.js";
import { startHttp } from "./http.js";

// The graph viewer routes moved from the `stoa serve` MCP server onto the
// `stoa ui` dashboard server (decision-2026-05-29-graph-viewer-served-by-stoa-ui).
// This suite verifies both halves: the routes ARE on the ui server, and are
// NOT on the serve server.

const SECRET = "test-secret-32-bytes-minimum-please-yes";
const UI_PORT = 4393; // sits below the transport-ui-bootstrap fixed ports (4394+)

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
const MINIMAL_LINKS = { "concept-foo": { outbound: [], inbound: [] } };

let vault: string;
let uiHandle: UiServerHandle;

function seedVault(): string {
  const v = mkdtempSync(join(tmpdir(), "stoa-graph-mount-"));
  mkdirSync(join(v, "wikis"), { recursive: true });
  mkdirSync(join(v, "_index"), { recursive: true });
  writeFileSync(join(v, "_index", "pages.json"), JSON.stringify(MINIMAL_PAGES));
  writeFileSync(join(v, "_index", "links.json"), JSON.stringify(MINIMAL_LINKS));
  return v;
}

beforeAll(async () => {
  vault = seedVault();
  uiHandle = await startUiServer({
    vaultPath: vault,
    port: UI_PORT,
    bind: "127.0.0.1",
    open: false,
  });
});

afterAll(async () => {
  await uiHandle.shutdown();
  rmSync(vault, { recursive: true, force: true });
});

describe("graph routes — mounted on the stoa ui dashboard server", () => {
  it("GET /graph/data returns 200 with nodes and links", async () => {
    const res = await fetch(`${uiHandle.url}/graph/data`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Array.isArray(body.nodes)).toBe(true);
    expect(Array.isArray(body.links)).toBe(true);
  });

  it("GET /graph/themes returns 200 with a themes array", async () => {
    const res = await fetch(`${uiHandle.url}/graph/themes`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("themes");
  });

  // Static-serve is a smoke test only — dist/viewer may not be built in CI.
  // 200 (built) or 404 (not built) are both fine; 500 would mean the handler threw.
  it("GET /graph does not return 500 (viewer static-serve wired)", async () => {
    const res = await fetch(`${uiHandle.url}/graph`);
    expect(res.status).not.toBe(500);
  });

  it("GET /assets/* does not return 500 (viewer bundle assets wired at root)", async () => {
    const res = await fetch(`${uiHandle.url}/assets/index.js`);
    expect(res.status).not.toBe(500);
  });
});

describe("graph routes — NOT mounted on the stoa serve MCP server", () => {
  let serveServer: Server | undefined;
  let servePort: number;

  beforeAll(async () => {
    process.env.STOA_TOKEN_SIGNING_SECRET = SECRET;
    serveServer = (await startHttp(
      { vaultPath: vault, mcpMode: false } as any,
      { bindOverride: "127.0.0.1:0" },
    )) as Server;
    await new Promise<void>((resolve) => {
      if (serveServer!.listening) return resolve();
      serveServer!.once("listening", () => resolve());
    });
    servePort = (serveServer!.address() as AddressInfo).port;
  });

  afterAll(async () => {
    if (serveServer) {
      await new Promise<void>((resolve) => serveServer!.close(() => resolve()));
    }
    delete process.env.STOA_TOKEN_SIGNING_SECRET;
  });

  it("GET /graph/data is 404 on the MCP server (route removed)", async () => {
    const res = await fetch(`http://127.0.0.1:${servePort}/graph/data`);
    expect(res.status).toBe(404);
  });

  it("/health stays public and /mcp stays bearer-gated (unchanged)", async () => {
    const health = await fetch(`http://127.0.0.1:${servePort}/health`);
    expect(health.status).toBe(200);
    const mcp = await fetch(`http://127.0.0.1:${servePort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(mcp.status).toBe(401);
  });
});
