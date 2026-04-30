import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { proposeEvolution } from "../core/evolution.js";
import { readProfile, renameProfile, ProfileNotFoundError } from "../core/profiles.js";
import { profileStatsTool } from "./profile-stats.js";
import { parseFrontmatter, serializeFrontmatter } from "../core/frontmatter.js";
import { EvolutionStage } from "../core/pokemon.js";

const ProposedShape = z.object({
  name: z.string().nullable(),
  evolution_stage: z.enum(["basic", "stage1", "stage2"]),
  moveset_additions: z.array(z.string()),
  moveset_removals: z.array(z.string()),
  autonomy_level: z.enum(["restricted", "feature-branch", "main-branch"])
});

const ProposalShape = z.object({
  eligible: z.boolean(),
  reason: z.string().optional(),
  current: z.object({
    name: z.string(),
    evolution_stage: z.enum(["basic", "stage1", "stage2"]),
    moveset: z.array(z.string()),
    autonomy_level: z.string()
  }),
  proposed: ProposedShape,
  rationale: z.string()
});

// Flat z.object so zodToJsonSchema produces type:"object" compatible with MCP SDK.
// commit:true fields are optional at the schema level; runtime validates them.
const Input = z.object({
  pokemon_id: z.string(),
  commit: z.boolean().default(false),
  expected_updated: z.string().optional(),
  proposal: ProposalShape.optional()
});

export const evolveProfileTool = {
  name: "vault.evolve-profile",
  description: "Two-phase profile evolution. commit:false returns a proposal (eligible? proposed shape, rationale). commit:true applies the proposal, optionally renaming the profile.",
  inputSchema: Input,
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    if (!input.commit) {
      // Proposal phase
      const profile = readProfile(ctx.vaultPath, input.pokemon_id);
      const stats = await profileStatsTool.handler({ pokemon_id: input.pokemon_id }, ctx);
      const proposal = proposeEvolution({
        profile: {
          id: input.pokemon_id,
          title: String(profile.frontmatter.title ?? input.pokemon_id),
          pokemon_type: String(profile.frontmatter.pokemon_type ?? "normal"),
          evolution_stage: (profile.frontmatter.evolution_stage ?? "basic") as EvolutionStage,
          autonomy_level: String(profile.frontmatter.autonomy_level ?? "restricted"),
          moveset: Array.isArray(profile.frontmatter.moveset) ? profile.frontmatter.moveset : [],
          created: String(profile.frontmatter.created ?? "")
        },
        stats: {
          tasks_completed: stats.tasks_completed,
          tasks_failed: stats.tasks_failed,
          success_rate: stats.success_rate,
          moves_used_freq: stats.moves_used_freq
        }
      });
      return proposal;
    }

    // Commit phase — validate required commit fields at runtime
    if (!input.expected_updated) {
      throw new Error("expected_updated is required when commit:true");
    }
    if (!input.proposal) {
      throw new Error("proposal is required when commit:true");
    }

    const profile = readProfile(ctx.vaultPath, input.pokemon_id);
    if (String(profile.frontmatter.updated ?? profile.frontmatter.created ?? "") !== input.expected_updated) {
      throw new Error(`OCC conflict: expected_updated ${input.expected_updated} does not match current ${profile.frontmatter.updated ?? profile.frontmatter.created}`);
    }

    const proposal = input.proposal;
    let oldId = input.pokemon_id;
    let newId = input.pokemon_id;
    let aliasRecorded = false;
    const filesRenamed: string[] = [];

    // 1. Rename if proposal.proposed.name is non-null and differs from current id
    if (proposal.proposed.name && proposal.proposed.name !== input.pokemon_id) {
      const renameResult = renameProfile(ctx.vaultPath, input.pokemon_id, proposal.proposed.name);
      newId = proposal.proposed.name;
      aliasRecorded = true;
      filesRenamed.push(renameResult.newPath);
    }

    // 2. Apply frontmatter changes (stage bump, autonomy, moveset additions/removals)
    const targetPath = join(
      ctx.vaultPath, "wikis", "_agents", "profiles", `${newId}.md`
    );
    const raw = readFileSync(targetPath, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);

    const currentMoveset: string[] = Array.isArray(frontmatter.moveset) ? frontmatter.moveset : [];
    const afterRemovals = currentMoveset.filter(m => !proposal.proposed.moveset_removals.includes(m));
    const afterAdditions = [...afterRemovals, ...proposal.proposed.moveset_additions.filter(m => !afterRemovals.includes(m))];

    const newFm: Record<string, any> = {
      ...frontmatter,
      evolution_stage: proposal.proposed.evolution_stage,
      autonomy_level: proposal.proposed.autonomy_level,
      moveset: afterAdditions,
      updated: new Date().toISOString().slice(0, 10)
    };

    writeFileSync(targetPath, serializeFrontmatter(newFm, body));

    return {
      old_id: oldId,
      new_id: newId,
      files_renamed: filesRenamed,
      files_resynced: [],  // C.1c will populate this when deployment registry exists
      alias_recorded: aliasRecorded
    };
  }
};
