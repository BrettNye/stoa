import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { buildIntent, deriveTools, getSourceRevision } from "../../src/core/subagent-intent.js";
import { ProfileNotFoundError } from "../../src/core/profiles.js";
import { MINIMAL_COORDINATION_TOOLSET } from "../../src/core/subagent-protocol.js";

let vaultPath: string;

function seedVault(): string {
  const v = mkdtempSync(join(tmpdir(), "vault-intent-"));
  mkdirSync(join(v, "_index"), { recursive: true });
  mkdirSync(join(v, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(v, "wikis", "_agents", "moves", "move-tdd-cycle"), { recursive: true });
  // Make it a git repo so getSourceRevision works.
  execSync("git init -q", { cwd: v });
  execSync('git config user.email "test@test.test"', { cwd: v });
  execSync('git config user.name "test"', { cwd: v });
  writeFileSync(join(v, ".gitignore"), "_index/\n");
  return v;
}

function writeMove(v: string, id: string, fields: Record<string, any> = {}): void {
  const dir = join(v, "wikis", "_agents", "moves", id);
  mkdirSync(dir, { recursive: true });
  const fm = [
    "---",
    `id: ${id}`,
    `title: ${fields.title ?? id}`,
    "type: move",
    "wiki: _agents",
    "status: active",
    "created: 2026-04-30",
    `summary: ${fields.summary ?? "test move"}`,
    `name: ${fields.name ?? id.replace(/^move-/, "")}`,
    `description: ${fields.description ?? "Use when X"}`,
    "applies_to: [claude-code]",
    "---",
    "",
    "# move",
    "",
    "## When to use",
    "",
    fields.applicability ?? "When the test demands it.",
  ].join("\n");
  writeFileSync(join(dir, "SKILL.md"), fm);
}

function writeProfileFile(
  v: string,
  id: string,
  fields: Record<string, any> = {},
  body: string = "# Test profile body\n"
): void {
  const dir = join(v, "wikis", "_agents", "profiles");
  mkdirSync(dir, { recursive: true });
  const fmLines = [
    "---",
    `id: ${id}`,
    `title: ${fields.title ?? id}`,
    "type: profile",
    "wiki: _agents",
    "status: active",
    "created: '2026-04-30'",
    `summary: ${fields.summary ?? "test profile"}`,
    `pokemon_type: ${fields.pokemon_type ?? "fire"}`,
    `evolution_stage: ${fields.evolution_stage ?? "basic"}`,
    `autonomy_level: ${fields.autonomy_level ?? "restricted"}`,
    `moveset: [${(fields.moveset ?? []).map((m: string) => `"${m}"`).join(", ")}]`,
    "applies_to:",
    "  - claude-code",
  ];
  if (fields.subagent_description) fmLines.push(`subagent_description: ${JSON.stringify(fields.subagent_description)}`);
  if (fields.model_tier) fmLines.push(`model_tier: ${fields.model_tier}`);
  if (fields.worktree_isolation) fmLines.push(`worktree_isolation: ${fields.worktree_isolation}`);
  fmLines.push("---", "", body);
  writeFileSync(join(dir, `${id}.md`), fmLines.join("\n"));
}

describe("subagent-intent — buildIntent (v1.7 §6.1, §6.2)", () => {
  beforeEach(() => {
    vaultPath = seedVault();
  });

  it("constructs an intent from a profile + its moveset", () => {
    writeMove(vaultPath, "move-tdd-cycle", {
      title: "TDD cycle",
      summary: "Red-green-refactor",
      applicability: "Any code change with measurable behavior",
    });
    writeProfileFile(vaultPath, "profile-charmander", {
      pokemon_type: "fire",
      evolution_stage: "basic",
      moveset: ["move-tdd-cycle"],
      summary: "Backend Pokemon",
    }, "# Charmander\n\nBackend specialist.\n");

    const intent = buildIntent(vaultPath, "profile-charmander");
    expect(intent.id).toBe("profile-charmander");
    expect(intent.pokemon_name).toBe("charmander");
    expect(intent.pokemon_type).toBe("fire");
    expect(intent.evolution_stage).toBe("basic");
    expect(intent.moveset).toHaveLength(1);
    expect(intent.moveset[0].id).toBe("move-tdd-cycle");
    expect(intent.moveset[0].title).toBe("TDD cycle");
    expect(intent.system_prompt).toContain("Backend specialist");
    expect(intent.applies_to).toContain("claude-code");
    expect(intent.source_revision).toBeTruthy();
  });

  it("uses subagent_description when present (§6.2)", () => {
    writeProfileFile(vaultPath, "profile-charmander", {
      subagent_description: "Use when implementing async-task code with TDD discipline",
      summary: "Backend Pokemon",
    });
    const intent = buildIntent(vaultPath, "profile-charmander");
    expect(intent.routing_description).toBe(
      "Use when implementing async-task code with TDD discipline"
    );
  });

  it("falls back to summary when subagent_description is absent (§6.2)", () => {
    writeProfileFile(vaultPath, "profile-charmander", {
      summary: "Backend Pokemon — async-task work",
    });
    const intent = buildIntent(vaultPath, "profile-charmander");
    expect(intent.routing_description).toBe("Backend Pokemon — async-task work");
  });

  it("throws ProfileNotFoundError for an unknown id", () => {
    expect(() => buildIntent(vaultPath, "profile-missing")).toThrow(ProfileNotFoundError);
  });

  it("alias-resolves a renamed profile id (§6.1 — id is profile-id, alias-aware via readProfile)", () => {
    writeProfileFile(vaultPath, "profile-charmeleon", {
      previous_names: ["profile-charmander"],
    });
    // Seed alias index manually (recordRename would write it during evolve-profile).
    writeFileSync(
      join(vaultPath, "_index", "aliases.json"),
      JSON.stringify({
        "profile-charmander": { current: "profile-charmeleon", history: ["profile-charmander"] }
      })
    );
    const intent = buildIntent(vaultPath, "profile-charmander");
    expect(intent.id).toBe("profile-charmeleon");
  });
});

describe("subagent-intent — deriveTools (v1.7 §6.5)", () => {
  it("always includes MINIMAL_COORDINATION_TOOLSET regardless of pokemon_type", () => {
    const tools = deriveTools(
      { pokemon_type: "fire", evolution_stage: "basic", moveset: [] } as any,
      []
    );
    for (const t of MINIMAL_COORDINATION_TOOLSET) {
      expect(tools).toContain(t);
    }
  });

  it("adds Bash + Edit + Read + Grep for combat profiles (fire/water/electric/etc.)", () => {
    const tools = deriveTools(
      { pokemon_type: "fire", evolution_stage: "basic", moveset: [] } as any,
      []
    );
    expect(tools).toContain("Bash");
    expect(tools).toContain("Edit");
    expect(tools).toContain("Read");
    expect(tools).toContain("Grep");
  });

  it("adds WebSearch + WebFetch for research-typed profiles (psychic)", () => {
    const tools = deriveTools(
      { pokemon_type: "psychic", evolution_stage: "stage2", moveset: [] } as any,
      []
    );
    expect(tools).toContain("WebSearch");
    expect(tools).toContain("WebFetch");
    // Coordination tools always present.
    expect(tools).toContain("vault.channel-post");
  });

  it("merges in tools_used: from each move's frontmatter", () => {
    const tools = deriveTools(
      { pokemon_type: "fire", evolution_stage: "basic", moveset: [] } as any,
      [{ id: "move-x", title: "x", summary: "", applicability: "", tools_used: ["Glob"] } as any]
    );
    expect(tools).toContain("Glob");
  });

  it("dedupes identical tools across moves + role + coordination set", () => {
    const tools = deriveTools(
      { pokemon_type: "fire", evolution_stage: "basic", moveset: [] } as any,
      [{ id: "move-x", title: "x", summary: "", applicability: "", tools_used: ["Bash"] } as any]
    );
    const bashCount = tools.filter(t => t === "Bash").length;
    expect(bashCount).toBe(1);
  });
});

describe("subagent-intent — getSourceRevision (v1.7 §6.4 invariant 5)", () => {
  beforeEach(() => {
    vaultPath = seedVault();
  });

  it("returns a non-empty git rev for a versioned vault", () => {
    writeFileSync(join(vaultPath, "seed.txt"), "seed");
    execSync("git add . && git commit -q -m seed", { cwd: vaultPath });
    const rev = getSourceRevision(vaultPath);
    expect(rev).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("returns 'vault-not-versioned' when vault is not a git repo", () => {
    const v = mkdtempSync(join(tmpdir(), "vault-no-git-"));
    expect(getSourceRevision(v)).toBe("vault-not-versioned");
  });
});
