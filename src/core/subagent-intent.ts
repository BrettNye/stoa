// v1.7 §6.1 + §6.2 + §6.5 — Build a SubagentIntent from a profile + moveset.
//
// The intent is the runtime-agnostic source of truth that adapters serialize
// into per-runtime files. buildIntent() is pure (no I/O outside reading the
// vault); deriveTools() is the rule that decides which native tools to
// expose alongside the minimal coordination toolset.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readProfile } from "./profiles.js";
import { parseFrontmatter } from "./frontmatter.js";
import {
  MINIMAL_COORDINATION_TOOLSET,
} from "./subagent-protocol.js";
import type {
  SubagentIntent,
  MoveReference,
  ToolName,
  RuntimeName,
} from "./runtime-adapters/types.js";

// Combat-shaped profile types: do dev-loop work (write code, run tests, edit files).
const COMBAT_TYPES = new Set([
  "fire", "water", "electric", "grass", "fighting", "rock", "ground",
  "ice", "bug", "poison", "steel", "flying", "dragon",
]);

// Research-shaped profile types: investigate, deposit, distill knowledge.
const RESEARCH_TYPES = new Set(["psychic", "ghost", "dark", "fairy", "normal"]);

const COMBAT_TOOLS: ToolName[] = ["Bash", "Edit", "Read", "Grep", "Glob", "Write"];
const RESEARCH_TOOLS: ToolName[] = ["WebSearch", "WebFetch", "Read", "Grep"];

export interface DeriveToolsProfileLike {
  pokemon_type: string;
  evolution_stage: string;
  moveset: string[];
}

export interface DeriveToolsMoveLike extends MoveReference {
  tools_used?: ToolName[];
}

export function deriveTools(
  profile: DeriveToolsProfileLike,
  moves: DeriveToolsMoveLike[]
): ToolName[] {
  const set = new Set<ToolName>(MINIMAL_COORDINATION_TOOLSET);
  const t = profile.pokemon_type.toLowerCase();
  if (COMBAT_TYPES.has(t)) {
    for (const x of COMBAT_TOOLS) set.add(x);
  } else if (RESEARCH_TYPES.has(t)) {
    for (const x of RESEARCH_TOOLS) set.add(x);
  }
  for (const m of moves) {
    if (Array.isArray(m.tools_used)) {
      for (const tu of m.tools_used) set.add(tu);
    }
  }
  return [...set];
}

export function getSourceRevision(vaultPath: string): string {
  if (!existsSync(join(vaultPath, ".git"))) {
    return "vault-not-versioned";
  }
  try {
    return execSync("git rev-parse HEAD", { cwd: vaultPath, encoding: "utf8" }).trim();
  } catch {
    return "vault-not-versioned";
  }
}

function loadMoveReference(vaultPath: string, moveId: string): DeriveToolsMoveLike | null {
  const skillPath = join(vaultPath, "wikis", "_agents", "moves", moveId, "SKILL.md");
  if (!existsSync(skillPath)) return null;
  const raw = readFileSync(skillPath, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  // Extract first ## When to use section as applicability text (best-effort).
  let applicability = "";
  const m = /^##\s+When to use\s*\n+([\s\S]*?)(?=\n##|\Z)/m.exec(body);
  if (m) applicability = m[1].trim();
  return {
    id: moveId,
    title: String(frontmatter.title ?? moveId),
    summary: String(frontmatter.summary ?? ""),
    applicability,
    tools_used: Array.isArray(frontmatter.tools_used) ? frontmatter.tools_used : undefined,
  };
}

export function buildIntent(vaultPath: string, profileId: string): SubagentIntent {
  const profile = readProfile(vaultPath, profileId);  // alias-aware
  const fm = profile.frontmatter;
  // The id we record is the resolved (current) id, NOT the alias the caller passed.
  const resolvedId = String(fm.id ?? profileId);
  const pokemon_name = resolvedId.startsWith("profile-")
    ? resolvedId.slice("profile-".length)
    : resolvedId;
  const moveIds: string[] = Array.isArray(fm.moveset) ? fm.moveset.map(String) : [];
  const moveRefs: MoveReference[] = [];
  const enrichedMoves: DeriveToolsMoveLike[] = [];
  for (const moveId of moveIds) {
    const ref = loadMoveReference(vaultPath, moveId);
    if (ref) {
      moveRefs.push({ id: ref.id, title: ref.title, summary: ref.summary, applicability: ref.applicability });
      enrichedMoves.push(ref);
    }
  }
  const tools_allowlist = deriveTools(
    {
      pokemon_type: String(fm.pokemon_type ?? "normal"),
      evolution_stage: String(fm.evolution_stage ?? "basic"),
      moveset: moveIds,
    },
    enrichedMoves
  );
  const routing_description = String(
    fm.subagent_description ?? fm.summary ?? `(no routing description for ${resolvedId})`
  );
  return {
    id: resolvedId,
    pokemon_name,
    pokemon_type: String(fm.pokemon_type ?? "normal"),
    evolution_stage: (fm.evolution_stage ?? "basic") as SubagentIntent["evolution_stage"],
    routing_description,
    system_prompt: profile.body,
    moveset: moveRefs,
    tools_allowlist,
    model_tier: (fm.model_tier ?? "inherit") as SubagentIntent["model_tier"],
    worktree_isolation: (fm.worktree_isolation ?? "recommended") as SubagentIntent["worktree_isolation"],
    applies_to: (Array.isArray(fm.applies_to) ? fm.applies_to : ["claude-code"]) as RuntimeName[],
    generated_at: new Date().toISOString(),
    source_revision: getSourceRevision(vaultPath),
  };
}
