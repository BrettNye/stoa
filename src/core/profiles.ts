import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readPage, writePage } from "./pages.js";
import { parseFrontmatter } from "./frontmatter.js";
import { readFileSync } from "node:fs";

export class ProfileNotFoundError extends Error {
  constructor(public id: string) {
    super(`profile not found: ${id}`);
    this.name = "ProfileNotFoundError";
  }
}

export interface ProfileInput {
  id: string;
  title: string;
  pokemon_type: string;
  secondary_pokemon_type?: string;
  region?: string;
  evolution_stage: "basic" | "stage1" | "stage2";
  autonomy_level?: "restricted" | "feature-branch" | "main-branch";
  moveset: string[];
  summary: string;
  applies_to?: string[];
  channels_tailed?: string[];
  body?: string;
  previous_names?: string[];
  expected_updated?: string;
}

export interface ProfileSummary {
  id: string;
  title: string;
  pokemon_type: string;
  evolution_stage: string;
  moveset: string[];
}

export function readProfile(vaultPath: string, id: string): { frontmatter: Record<string, any>; body: string; updated: string; path: string } {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  const path = join(profilesDir, `${id}.md`);
  if (!existsSync(path)) {
    throw new ProfileNotFoundError(id);
  }
  const raw = readFileSync(path, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    frontmatter, body, path,
    updated: String(frontmatter.updated ?? frontmatter.created ?? "")
  };
}

export function writeProfile(vaultPath: string, input: ProfileInput): { id: string; path: string; updated: string } {
  const today = new Date().toISOString().slice(0, 10);
  const STAGE_TO_AUTONOMY: Record<string, string> = {
    basic: "restricted", stage1: "feature-branch", stage2: "main-branch"
  };
  const fm: Record<string, any> = {
    id: input.id,
    title: input.title,
    type: "profile",
    wiki: "_agents",
    status: "active",
    created: today,
    updated: today,
    summary: input.summary,
    pokemon_type: input.pokemon_type,
    evolution_stage: input.evolution_stage,
    autonomy_level: input.autonomy_level ?? STAGE_TO_AUTONOMY[input.evolution_stage] ?? "restricted",
    moveset: input.moveset,
    applies_to: input.applies_to ?? ["claude-code"]
  };
  if (input.secondary_pokemon_type) fm.secondary_pokemon_type = input.secondary_pokemon_type;
  if (input.region) fm.region = input.region;
  if (input.channels_tailed) fm.channels_tailed = input.channels_tailed;
  if (input.previous_names) fm.previous_names = input.previous_names;

  return writePage(vaultPath, {
    id: input.id,
    type: "profile",
    wiki: "_agents",
    frontmatter: fm,
    body: input.body ?? `# ${input.title}\n\n(role description)`,
    expectedUpdated: input.expected_updated
  });
}

export function listProfiles(vaultPath: string): ProfileSummary[] {
  const profilesDir = join(vaultPath, "wikis", "_agents", "profiles");
  if (!existsSync(profilesDir)) return [];
  const entries = readdirSync(profilesDir).filter(f => f.endsWith(".md"));
  const out: ProfileSummary[] = [];
  for (const file of entries) {
    const id = file.replace(/\.md$/, "");
    try {
      const p = readProfile(vaultPath, id);
      out.push({
        id,
        title: String(p.frontmatter.title ?? id),
        pokemon_type: String(p.frontmatter.pokemon_type ?? "normal"),
        evolution_stage: String(p.frontmatter.evolution_stage ?? "basic"),
        moveset: Array.isArray(p.frontmatter.moveset) ? p.frontmatter.moveset : []
      });
    } catch {
      // skip malformed
    }
  }
  return out;
}

export function getMoveset(vaultPath: string, profile_id: string): string[] {
  const p = readProfile(vaultPath, profile_id);
  return Array.isArray(p.frontmatter.moveset) ? p.frontmatter.moveset : [];
}
