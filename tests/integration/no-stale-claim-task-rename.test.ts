import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// VAULT_ROOT is the worktree root (parent of vault-mcp/, wikis/, .claude/).
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT_ROOT = path.resolve(__dirname, "../../..");

// Files allowed to discuss the historical name. The spec records the rename;
// the foundation-dag plan inlines the test source (which itself contains the
// literal needle), so it would self-trigger.
const ALLOWLIST = new Set<string>([
  "wikis/_meta/specs/2026-05-02-vault-mcp-claims-design.md",
  "wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md",
]);

// Roots to scan and the file extensions to consider in each.
// Skips node_modules/ and dist/ implicitly (see SKIP_DIRS).
const SCAN_ROOTS: Array<{ dir: string; exts: string[] }> = [
  { dir: "vault-mcp/src", exts: [".ts"] },
  { dir: "vault-mcp/tests", exts: [".ts"] },
  { dir: "wikis/_agents", exts: [".md"] },
  { dir: "wikis/_meta", exts: [".md"] },
  { dir: "wikis/_templates", exts: [".md"] },
  { dir: ".claude", exts: [".md"] },
];

const SKIP_DIRS = new Set<string>(["node_modules", "dist", ".git"]);

// Constructed at runtime so this test file does not itself contain the literal
// string it is searching for (which would otherwise trigger a self-match).
const NEEDLE = ["vault", ".", "claim", "-", "task"].join("");

async function walk(root: string, exts: string[]): Promise<string[]> {
  const out: string[] = [];
  async function recurse(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof fs.readdir>>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return;
      throw err;
    }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        await recurse(abs);
      } else if (ent.isFile()) {
        if (exts.some((x) => ent.name.endsWith(x))) out.push(abs);
      }
    }
  }
  await recurse(root);
  return out;
}

describe(`no stale ${NEEDLE} references`, () => {
  it("finds zero references in production code or vault content", async () => {
    const allFiles: string[] = [];
    for (const { dir, exts } of SCAN_ROOTS) {
      const abs = path.join(VAULT_ROOT, dir);
      const files = await walk(abs, exts);
      allFiles.push(...files);
    }

    const offenders: string[] = [];
    for (const abs of allFiles) {
      const rel = path.relative(VAULT_ROOT, abs).replace(/\\/g, "/");
      if (ALLOWLIST.has(rel)) continue;
      const content = await fs.readFile(abs, "utf8");
      if (content.includes(NEEDLE)) offenders.push(rel);
    }

    expect(
      offenders,
      `Stale '${NEEDLE}' references found in:\n${offenders.join("\n")}`
    ).toHaveLength(0);
  });
});
