// v1.7 §7.1 — vault.sync-agents MCP tool.
//
// Per-Pokemon flow:
//   1. resolve profile id (alias-aware via readProfile inside buildIntent)
//   2. build SubagentIntent
//   3. lookup adapter by runtime
//   4. validate (errors halt; warnings surface)
//   5. serialize (no-op call exposed via deploy)
//   6. deploy (writes files + records registry; idempotent on source_revision)
//   7. optional syncMoveset (back-compat surface — same call sync-skills uses)
//   8. verify (re-check invariants 1+2 on on-disk artifact)
//
// Multi-Pokemon: sequential, halt-on-first-error per §7.1. Already-deployed
// Pokemon stay deployed; subsequent Pokemon not attempted.

import { z } from "zod";
import { withSerializedIndexWrite } from "../core/index-locking.js";
import { buildIntent } from "../core/subagent-intent.js";
import { getAdapter } from "../core/runtime-adapters/registry.js";
import { syncMoveset } from "../core/skills.js";
import { resolveCurrent } from "../core/aliases.js";
import { ProfileNotFoundError } from "../core/profiles.js";
import type { RuntimeName, ValidationDiagnostic } from "../core/runtime-adapters/types.js";

const PokemonInput = z.union([z.string(), z.array(z.string())]);

const Common = z.object({
  target: z.string(),
  runtime: z.enum(["claude-code"]).default("claude-code"),
  mode: z.enum(["copy", "symlink"]).default("copy"),
  overwrite: z.boolean().default(true),
  include_moveset: z.boolean().default(true),
  continue_on_error: z.boolean().default(false),
});

const Explicit = Common.extend({
  pokemon: PokemonInput,
  all: z.literal(false).optional(),
  exclude: z.undefined().optional(),
  pokemon_type: z.undefined().optional(),
});

const All = Common.extend({
  pokemon: z.undefined().optional(),
  all: z.literal(true),
  exclude: z.array(z.string()).default([]),
  pokemon_type: z.array(z.string()).default([]),
});

const Input = z.union([Explicit, All]).refine(
  (v) => v.all === true || v.pokemon !== undefined,
  { message: "one of `pokemon` or `all: true` is required" }
);

export interface PerPokemonResult {
  pokemon: string;
  deployed: Record<string, string>;
  registry_entry: { runtime: RuntimeName; source_revision: string; subagent_def_path: string };
  moveset_synced: boolean;
  status: "deployed" | "skipped-no-change" | "failed";
  warnings?: ValidationDiagnostic[];
  error?: string;
}

export interface ResultShape {
  results: PerPokemonResult[];
  summary: { requested: number; deployed: number; skipped: number; failed: number };
}

function normalizeProfileId(vaultPath: string, raw: string): string {
  // Three-step alias resolution: raw → profile-<raw> → alias overlay.
  const r1 = resolveCurrent(vaultPath, raw);
  if (r1 !== raw) return r1;
  const candidate = raw.startsWith("profile-") ? raw : `profile-${raw}`;
  return resolveCurrent(vaultPath, candidate);
}

async function deploySingle(
  vaultPath: string,
  rawPokemon: string,
  target: string,
  runtime: RuntimeName,
  mode: "copy" | "symlink",
  overwrite: boolean,
  includeMoveset: boolean
): Promise<PerPokemonResult> {
  const profileId = normalizeProfileId(vaultPath, rawPokemon);

  let intent;
  try {
    intent = buildIntent(vaultPath, profileId);
  } catch (e: any) {
    if (e instanceof ProfileNotFoundError) {
      return {
        pokemon: rawPokemon, deployed: {}, registry_entry: {} as any,
        moveset_synced: false, status: "failed",
        error: `profile not found: ${rawPokemon}`,
      };
    }
    throw e;
  }

  const adapter = getAdapter(runtime);

  // Serialize all writes to the deployments registry (multi-instance safety).
  return withSerializedIndexWrite(vaultPath, ["deployments.json"], async (): Promise<PerPokemonResult> => {
    const validation = await adapter.validate(intent, target);
    if (!validation.ok) {
      return {
        pokemon: profileId, deployed: {}, registry_entry: {} as any,
        moveset_synced: false, status: "failed",
        error: `validate failed: ${validation.errors.map(e => e.message).join("; ")}`,
        warnings: validation.warnings,
      };
    }

    const deployResult = await adapter.deploy(intent, target, {
      mode, overwrite, registry_path: vaultPath,
    });

    let movesetSynced = false;
    if (includeMoveset && deployResult.status === "deployed") {
      try {
        syncMoveset({
          vaultPath, repoPath: target, pokemon_id: profileId,
          target: "claude-code", mode,
        });
        movesetSynced = true;
      } catch (e: any) {
        return {
          pokemon: profileId, deployed: {}, registry_entry: {} as any,
          moveset_synced: false, status: "failed",
          error: `syncMoveset failed: ${e.message}`,
          warnings: validation.warnings,
        };
      }
    }

    const verify = await adapter.verify(intent, target);
    if (!verify.ok) {
      return {
        pokemon: profileId, deployed: {}, registry_entry: {} as any,
        moveset_synced: movesetSynced, status: "failed",
        error: `verify failed: ${verify.violations.map(v => v.message).join("; ")}`,
        warnings: validation.warnings,
      };
    }

    return {
      pokemon: profileId,
      deployed: { agent_def: deployResult.files_written[0] },
      registry_entry: {
        runtime,
        source_revision: deployResult.source_revision,
        subagent_def_path: deployResult.files_written[0],
      },
      moveset_synced: movesetSynced,
      status: deployResult.status,
      warnings: validation.warnings,
    };
  });
}

export const syncAgentsTool = {
  name: "vault.sync-agents",
  description: "Deploy a Pokemon (or list of Pokemon) as runtime subagent definitions in a target repo. Builds a SubagentIntent from the profile + moveset, hands to the per-runtime adapter (currently claude-code), and writes <target>/.claude/agents/<pokemon-id>.md plus optional moveset SKILL.md files. Idempotent on source_revision. Sequential halt-on-first-error for multi-Pokemon batches.",
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: { vaultPath: string }
  ): Promise<ResultShape> => {
    // Task 3 will dispatch on (input as any).all === true and call enumerateProfilesForSync.
    // For now, the existing explicit-pokemon path remains the only supported branch.
    const pokemonRaw = (input as any).pokemon as string | string[] | undefined;
    const list = Array.isArray(pokemonRaw) ? pokemonRaw : pokemonRaw !== undefined ? [pokemonRaw] : [];
    const results: PerPokemonResult[] = [];

    for (const p of list) {
      const r = await deploySingle(
        ctx.vaultPath, p, input.target, input.runtime,
        input.mode, input.overwrite, input.include_moveset
      );
      results.push(r);
      if (r.status === "failed") break;  // halt-on-first-error
    }

    const summary = {
      requested: list.length,
      deployed: results.filter(r => r.status === "deployed").length,
      skipped: results.filter(r => r.status === "skipped-no-change").length,
      failed: results.filter(r => r.status === "failed").length,
    };
    return { results, summary };
  }
};
