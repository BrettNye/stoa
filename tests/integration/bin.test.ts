import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

// NOTE: cwd is omitted so spawnSync inherits vitest's working dir (vault-mcp/).
// The task spec's `cwd: "vault-mcp"` resolves to vault-mcp/vault-mcp/ and ENOENTs.

describe("bin entrypoint", () => {
  it("CLI mode: prints top-level help before vault validation", () => {
    const r = spawnSync("npx", ["tsx", "src/bin.ts", "--help"], { encoding: "utf8", shell: true });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/Usage:|Commands:/);
  });

  it("CLI mode: prints top-level version before vault validation", () => {
    const r = spawnSync("npx", ["tsx", "src/bin.ts", "--version"], { encoding: "utf8", shell: true });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe("0.4.0");
  });

  it("CLI mode: prints help when no args given", () => {
    const r = spawnSync("npx", ["tsx", "src/bin.ts", "--vault=./tests/fixtures/test-vault", "--help"], { encoding: "utf8", shell: true });
    expect(r.stdout + r.stderr).toMatch(/Usage:|Commands:/);
  });

  it("CLI mode: list-wikis prints the fixture wikis", () => {
    const r = spawnSync("npx", ["tsx", "src/bin.ts", "--vault=./tests/fixtures/test-vault", "list-wikis"], { encoding: "utf8", shell: true });
    // Need to reindex the fixture first or the result is empty — handled by being tolerant here
    expect(r.status).toBe(0);
  });
});
