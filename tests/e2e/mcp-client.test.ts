import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { copyFixtureVault } from "../fixtures/copy-fixture.js";
import { reindex } from "../../src/core/reindex.js";
import { resolve } from "node:path";

let vault: string;
let client: Client;

// npx is a .cmd shim on Windows; bare "npx" fails to spawn from Node.
const isWindows = process.platform === "win32";
const npxCmd = isWindows ? "npx.cmd" : "npx";

beforeAll(async () => {
  vault = copyFixtureVault();
  reindex(vault);

  const transport = new StdioClientTransport({
    command: npxCmd,
    args: ["tsx", resolve(process.cwd(), "src/bin.ts"), "--mcp", `--vault=${vault}`],
    cwd: process.cwd()
  });
  client = new Client({ name: "vault-test", version: "0.0.1" }, { capabilities: {} });
  await client.connect(transport);
}, 30000);

afterAll(async () => {
  try {
    await client?.close();
  } catch {
    // best-effort: don't let teardown fail the suite
  }
});

describe("MCP e2e", () => {
  it("lists 21 tools", { timeout: 30000 }, async () => {
    const r = await client.listTools();
    expect(r.tools).toHaveLength(21);
    const names = r.tools.map(t => t.name).sort();
    expect(names).toContain("vault.recall");
    expect(names).toContain("vault.task-claim");
  });

  it("vault.recall returns hits from fixture", { timeout: 30000 }, async () => {
    const r = await client.callTool({ name: "vault.recall", arguments: { topic: "foo" } });
    const data = JSON.parse((r.content as any)[0].text);
    expect(data.hits.length).toBeGreaterThan(0);
  });

  it("vault.list-wikis returns fixture wikis", { timeout: 30000 }, async () => {
    const r = await client.callTool({ name: "vault.list-wikis", arguments: {} });
    const data = JSON.parse((r.content as any)[0].text);
    const names = data.wikis.map((w: any) => w.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  it("vault.read fetches a known page", { timeout: 30000 }, async () => {
    const r = await client.callTool({ name: "vault.read", arguments: { id: "concept-foo", wiki: "alpha" } });
    const data = JSON.parse((r.content as any)[0].text);
    expect(data.frontmatter.id).toBe("concept-foo");
    expect(data.body.length).toBeGreaterThan(0);
  });
});
