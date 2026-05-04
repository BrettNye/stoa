// vault-mcp/tests/helpers.ts
//
// Shared test helpers for the claims plan (Plan 1) test suites. Hoisted per
// the plan's S7 (test-helper hoisting) + H8 (import resolution) hazards: 13
// downstream tasks import from this file, so it lives upstream of all of
// them in the DAG. See `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-
// 1-foundation-dag.md` §task-test-helpers for the contract.
//
// Conventions:
// - Temp vaults under `os.tmpdir()` with `mkdtempSync` (synchronous because
//   we want a stable directory name before any async work begins).
// - Frontmatter is serialized via `JSON.stringify` per value to dodge YAML
//   escaping pitfalls (matches the v1.5 friction T3-5 lesson on ISO date
//   quoting).
// - `callTool` dynamically imports the tools registry to avoid a static
//   dependency cycle when individual tool modules import test-only helpers
//   transitively.

import { promises as fs, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export async function mkTempVault(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-claim-test-"));
  await fs.mkdir(path.join(dir, "wikis", "_agents", "claim"), { recursive: true });
  await fs.mkdir(path.join(dir, "_index"), { recursive: true });
  return dir;
}

export interface ClaimFixtureInput {
  id: string;
  key: string;
  status: "active" | "superseded" | "retracted" | "draft";
  confidence: number;
  last_validated?: string;
  profile?: string[];
  move?: string[];
  scope_wiki?: string[];
  tags?: string[];
  evidence?: string[];
  authored_by?: string;
  superseded_by?: string | null;
  body?: string;
  wiki?: string;
}

export async function writeClaimFile(vaultPath: string, claim: ClaimFixtureInput): Promise<void> {
  const wiki = claim.wiki ?? "_agents";
  const dir = path.join(vaultPath, "wikis", wiki, "claim");
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${claim.id}.md`);
  const fm: Record<string, unknown> = {
    id: claim.id,
    type: "claim",
    title: claim.id,
    created: "2026-05-02",
    key: claim.key,
    status: claim.status,
    confidence: claim.confidence,
    last_validated: claim.last_validated ?? "2026-05-02",
    profile: claim.profile ?? [],
    move: claim.move ?? [],
    scope_wiki: claim.scope_wiki ?? [],
    tags: claim.tags ?? [],
    evidence: claim.evidence ?? [],
    authored_by: claim.authored_by ?? "agent:test",
    superseded_by: claim.superseded_by ?? null,
    wiki,
  };
  const yaml = Object.entries(fm)
    .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
    .join("\n");
  await fs.writeFile(file, `---\n${yaml}\n---\n\n${claim.body ?? ""}`, "utf8");
}

export async function mkTempVaultWithSidecar(claims: ClaimFixtureInput[]): Promise<string> {
  const vault = await mkTempVault();
  for (const c of claims) await writeClaimFile(vault, c);
  // Write a minimal sidecar reflecting the claims (callers may use buildClaimsIndex
  // when that exists; this fallback supports tests that pre-date its availability).
  const sidecar = {
    by_profile: {} as Record<string, string[]>,
    by_move: {} as Record<string, string[]>,
    by_scope_wiki: {} as Record<string, string[]>,
    by_tag: {} as Record<string, string[]>,
    global: [] as string[],
    generated_at: new Date().toISOString(),
    schema_version: 1 as const,
  };
  for (const c of claims) {
    if (c.status !== "active") continue;
    for (const p of c.profile ?? []) (sidecar.by_profile[p] ??= []).push(c.id);
    for (const m of c.move ?? []) (sidecar.by_move[m] ??= []).push(c.id);
    for (const w of c.scope_wiki ?? []) (sidecar.by_scope_wiki[w] ??= []).push(c.id);
    for (const t of c.tags ?? []) (sidecar.by_tag[t] ??= []).push(c.id);
    if (!(c.profile ?? []).length && !(c.move ?? []).length && !(c.scope_wiki ?? []).length) {
      sidecar.global.push(c.id);
    }
  }
  await fs.writeFile(path.join(vault, "_index", "claims.json"), JSON.stringify(sidecar, null, 2), "utf8");
  return vault;
}

export async function mkTempVaultWithDeployments(deployments: Array<{ repo: string }>): Promise<string> {
  const vault = await mkTempVault();
  await fs.writeFile(
    path.join(vault, "_index", "deployments.json"),
    JSON.stringify(deployments, null, 2),
    "utf8"
  );
  return vault;
}

export interface PageStub {
  frontmatter: Record<string, unknown>;
  content?: string;
  filePath?: string;
}

export function makePage(frontmatter: Record<string, unknown>): PageStub {
  return { frontmatter, content: "", filePath: `<test:${frontmatter.id ?? "anon"}>` };
}

export async function callTool(toolName: string, input: unknown, vaultPath: string): Promise<any> {
  // Tools registry exports `allTools` (see vault-mcp/src/tools/index.ts). The
  // plan template referenced `tools`; the source-of-truth name is `allTools`.
  const mod = await import("../src/tools/index.js");
  const list = (mod as { allTools: Array<{ name: string; handler: Function }> }).allTools;
  const tool = list.find((t) => t.name === toolName);
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return await tool.handler(input, { vaultPath, rawConfig: {} });
}
