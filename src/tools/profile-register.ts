// vault-mcp/src/tools/profile-register.ts
//
// Register a vault profile with the Stadium platform. Reads
// `wikis/<wiki>/profiles/<profile_id>.md`, extracts the species name from the
// existing `pokemon` frontmatter field (v1.5 convention; falls back to the
// older `species_name` field for compatibility), POSTs to
// `/profiles/register`, and persists the returned `profile_id` + stats back
// onto the file as `platform_profile_id` and `platform_stats`.
//
// Server errors (e.g. `pokeapi_unknown_species`) propagate as
// `StadiumApiError` from the underlying StadiumClient — callers see the
// `error_code` directly.
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, serializeFrontmatter } from "../core/frontmatter.js";
import { resolveStadiumConfig } from "../core/stadium-config.js";
import { StadiumClient } from "../core/stadium-client.js";
import { upsertPage } from "../core/index.js";
import { resolveTrainerContext, type TrainerContext } from "../core/resolve-trainer-context.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  profile_id: z.string().regex(/^profile-/),
  wiki: z.string().optional()
});

export const profileRegisterTool = {
  name: "vault_profile-register",
  description:
    "Register a profile with the Stadium platform; persist returned platform_profile_id + stats to the profile file.",
  scope: {
    axis: () => 'stadium',
    adminOnly: () => true,
  } satisfies ToolScope,
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string; defaultWiki?: string }
  ) => {
    const parsed = Input.parse(input);

    // Resolve trainer context for wiki routing (synthesis A2 fix).
    // Resolution priority: explicit wiki: arg > trainer's wiki: frontmatter.
    // There is NO fallback to ctx.defaultWiki / .active-wiki (spec §2 A2 fix).
    // - If explicit wiki: arg is provided, it wins; trainer resolution errors are
    //   suppressed (explicit arg short-circuits the trainer resolution entirely).
    // - If no explicit wiki: arg, the trainer must exist and have a wiki: field.
    //   Any TrainerContextError (NO_ACTIVE_TRAINER, TRAINER_NOT_FOUND,
    //   TRAINER_WIKI_UNSET) propagates — no silent fallback.
    let trainerCtx: TrainerContext | undefined;
    if (!parsed.wiki) {
      // No explicit wiki arg — trainer resolution is required; errors propagate.
      trainerCtx = resolveTrainerContext({}, { vaultPath: ctx.vaultPath });
    } else {
      // Explicit wiki arg provided — trainer resolution is best-effort only
      // (the trainer id is still surfaced in caller_trainer_id when available).
      try {
        trainerCtx = resolveTrainerContext({}, { vaultPath: ctx.vaultPath });
      } catch {
        trainerCtx = undefined;
      }
    }

    // Explicit wiki arg wins; otherwise use the trainer's wiki: frontmatter field.
    const wiki = parsed.wiki ?? trainerCtx?.wiki;
    if (!wiki) throw new Error("wiki resolution failed: no explicit arg and no resolved trainer context");
    const path = join(
      ctx.vaultPath,
      "wikis",
      wiki,
      "profiles",
      `${parsed.profile_id}.md`
    );
    const raw = readFileSync(path, "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);

    // v1.5 convention: profiles carry `pokemon: <slug>`. Older or
    // hand-authored profiles may use `species_name:` directly. Either is
    // acceptable input; the server contract takes `species_name`.
    const species_name =
      (frontmatter as Record<string, unknown>).pokemon ??
      (frontmatter as Record<string, unknown>).species_name;
    if (!species_name) {
      throw new Error(
        `profile ${parsed.profile_id} missing 'pokemon' field (and no fallback 'species_name')`
      );
    }
    if (typeof species_name !== 'string') {
      throw new Error(
        `profile ${parsed.profile_id}: 'pokemon' field must be a string, got ${typeof species_name}`
      );
    }
    const VALID_STAGES = new Set(['basic', 'stage1', 'stage2']);
    const rawStage = (frontmatter as Record<string, unknown>).evolution_stage;
    const evolution_stage: 'basic' | 'stage1' | 'stage2' =
      typeof rawStage === 'string' && VALID_STAGES.has(rawStage)
        ? rawStage as 'basic' | 'stage1' | 'stage2'
        : 'basic';

    const config = resolveStadiumConfig();
    const client = new StadiumClient({
      api_key: config.api_key,
      base_url: config.base_url
    });
    const result = await client.registerProfile({
      species_name,
      evolution_stage,
      vault_profile_id: parsed.profile_id
    });

    const updated: Record<string, unknown> = {
      ...frontmatter,
      platform_profile_id: result.profile_id,
      platform_stats: result.stats
    };
    writeFileSync(path, serializeFrontmatter(updated, body));
    await upsertPage(ctx.vaultPath, path);
    return { profile_id: result.profile_id, stats: result.stats, caller_trainer_id: trainerCtx?.trainerId };
  }
};
