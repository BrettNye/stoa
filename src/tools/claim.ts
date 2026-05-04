// vault-mcp/src/tools/claim.ts
//
// task-claim-tool — `vault.claim` MCP tool. Single tool covers the four
// authoring actions: create, re-validate, supersede, retract (with reject as
// the no-write counterpoint to supersede when confidence is too low).
//
// Plan reference:
//   `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
//   §task-claim-tool.
// Spec reference:
//   `wikis/_meta/specs/2026-05-02-vault-mcp-claims-design.md` §6.3-6.7, §7.1.
//
// Registration: this tool is intentionally NOT exported from
// `src/tools/index.ts` in the same commit — that's the downstream wiring task
// (`task-tools-index-registration`). Tests exercise `claimTool.handler`
// directly until then.
//
// Context shape: production callers thread a `DispatchCtx` (see
// `src/transport/stdio.ts`); the optional `rawConfig` slot is the plan's
// reservation for plumbing the vault-config dictionary through to
// `getClaimsConfig`. When absent, the tool falls back to spec §6.2 defaults.

import { createHash } from "node:crypto";
import { z } from "zod";
import { ClaimsStore } from "../core/claims.js";
import { scopeHash } from "../core/scope-hash.js";
import { effectiveConfidence } from "../core/decay.js";
import { getClaimsConfig } from "../config.js";
import { slugify } from "../core/ids.js";
import type { ClaimFrontmatter } from "../types/claim.js";

const Input = z.object({
  // Authoring
  key: z.string().optional(),
  title: z.string().optional(),
  body: z.string().optional(),

  // Scope
  profile: z.array(z.string()).optional(),
  move: z.array(z.string()).optional(),
  scope_wiki: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),

  // Confidence + provenance
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(z.string()).optional(),

  // Caller identity (mirrors task-claim's `as` convention)
  as: z.string().min(1),

  // Mutually-exclusive modifiers
  override: z.boolean().optional(),
  revalidate: z.boolean().optional(),
  retract: z.string().optional(),
  reason: z.string().optional(),

  // Wiki home
  wiki: z.string().optional(),
});
export type ClaimToolInput = z.infer<typeof Input>;

export interface ClaimToolCtx {
  vaultPath: string;
  defaultWiki?: string;
  rawConfig?: unknown;
}

export interface ClaimToolResult {
  claim_id: string;
  action: "created" | "revalidated" | "superseded" | "retracted" | "rejected";
  superseded_id?: string;
  rejection?: {
    reason: string;
    existing_id: string;
    existing_effective_confidence: number;
    your_confidence: number;
    suggestion: string;
  };
  reindex_recommended: true;
}

export const claimTool = {
  name: "vault.claim",
  description:
    "Author, re-validate, supersede, or retract a claim. Single primitive over the four authoring actions; see spec §7.1.",
  inputSchema: Input,
  handler: async (input: ClaimToolInput, ctx: ClaimToolCtx): Promise<ClaimToolResult> => {
    // Mutual exclusion of modifiers (§6.4 / §6.5).
    const modCount = [
      input.override === true,
      input.revalidate === true,
      typeof input.retract === "string" && input.retract.length > 0,
    ].filter(Boolean).length;
    if (modCount > 1) {
      throw new Error("override, revalidate, and retract are mutually exclusive");
    }

    const store = new ClaimsStore();
    const claimsCfg = getClaimsConfig(ctx.rawConfig ?? {});
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    // Retract path (§6.5).
    if (input.retract) {
      if (!input.reason || input.reason.length === 0) {
        throw new Error("--reason is required for retraction");
      }
      return await retractAction(store, ctx.vaultPath, input.retract, input.as, input.reason, todayIso);
    }

    // For every other path, key is required.
    if (!input.key) {
      throw new Error("key is required for create / revalidate / supersede");
    }

    // Profile scoping default (§6.6): no `profile:` arg → [<as>]; explicit
    // [] → global (preserved as-is).
    const profile = input.profile === undefined ? [input.as] : input.profile;
    const move = input.move ?? [];
    const scope_wiki = input.scope_wiki ?? [];
    const tags = input.tags ?? [];

    const sh = scopeHash(profile, move, scope_wiki, tags);
    const existing = await store.findByIdentity(ctx.vaultPath, input.key, sh);

    // Revalidate path (§6.4).
    if (input.revalidate) {
      if (!existing) {
        throw new Error(`no claim to re-validate at ${input.key}+${sh}`);
      }
      return await revalidateAction(store, ctx.vaultPath, existing, input, todayIso);
    }

    // Create path (no existing claim).
    if (!existing) {
      return await createAction(
        store,
        ctx.vaultPath,
        input,
        profile,
        move,
        scope_wiki,
        tags,
        todayIso,
        sh,
      );
    }

    // Supersede / reject path (§6.3).
    const existingEffective = effectiveConfidence(existing, today, {
      half_life_days: claimsCfg.half_life_days,
      effective_floor: claimsCfg.effective_floor,
    });
    const newConf = input.confidence ?? 0.7;

    if (input.override === true || newConf > existingEffective) {
      return await supersedeAction(
        store,
        ctx.vaultPath,
        existing,
        input,
        profile,
        move,
        scope_wiki,
        tags,
        todayIso,
        sh,
      );
    }

    return rejectionResponse(existing, existingEffective, newConf);
  },
};

// ---- action implementations ----

function generateClaimId(
  title: string | undefined,
  key: string,
  scope_hash: string,
  body: string | undefined,
  todayIso: string,
): string {
  const slugSource = title && title.length > 0 ? title : key;
  const slug = slugify(slugSource) || "untitled";
  // Short suffix derived from the identity tuple plus a wall-clock nonce so
  // back-to-back supersessions with the same title don't collide on disk.
  // sha256 keeps the suffix stable for a given (title, key, scope_hash,
  // timestamp, body) tuple — useful only as a uniqueness guard, not as
  // identity (identity is `(key, scope_hash)`, the same as findByIdentity).
  const nonce = `${todayIso}-${Date.now()}-${process.hrtime.bigint().toString(36)}`;
  const suffix = createHash("sha256")
    .update(`${slug}|${key}|${scope_hash}|${body ?? ""}|${nonce}`)
    .digest("hex")
    .slice(0, 8);
  return `claim-${slug}-${suffix}`;
}

function defaultWiki(input: ClaimToolInput, ctx: ClaimToolCtx): string {
  return input.wiki ?? ctx.defaultWiki ?? "_agents";
}

async function createAction(
  store: ClaimsStore,
  vaultPath: string,
  input: ClaimToolInput,
  profile: string[],
  move: string[],
  scope_wiki: string[],
  tags: string[],
  todayIso: string,
  scope_hash: string,
): Promise<ClaimToolResult> {
  const wiki = defaultWiki(input, { vaultPath } as ClaimToolCtx);
  const id = generateClaimId(input.title, input.key!, scope_hash, input.body, todayIso);
  const fm: ClaimFrontmatter = {
    id,
    type: "claim",
    title: input.title ?? input.key!,
    created: todayIso,
    key: input.key!,
    confidence: input.confidence ?? 0.7,
    last_validated: todayIso,
    profile,
    move,
    scope_wiki,
    tags,
    evidence: input.evidence ?? [],
    status: "active",
    supersedes: [],
    superseded_by: null,
    retracted_at: null,
    retracted_by: null,
    retraction_reason: null,
    wiki,
    summary: input.title ?? input.key!,
    updated: todayIso,
    authored_by: input.as,
  };
  await store.write(vaultPath, fm, input.body ?? "");
  return { claim_id: id, action: "created", reindex_recommended: true };
}

async function supersedeAction(
  store: ClaimsStore,
  vaultPath: string,
  existing: Awaited<ReturnType<ClaimsStore["read"]>> & object,
  input: ClaimToolInput,
  profile: string[],
  move: string[],
  scope_wiki: string[],
  tags: string[],
  todayIso: string,
  scope_hash: string,
): Promise<ClaimToolResult> {
  const wiki = defaultWiki(input, { vaultPath } as ClaimToolCtx);
  const newId = generateClaimId(input.title, input.key!, scope_hash, input.body, todayIso);

  // 1. Write the new active claim first. If it fails, the old one stays
  //    active — safer than the inverse order, which would leave the old
  //    superseded with no supersedor on disk.
  const newFm: ClaimFrontmatter = {
    id: newId,
    type: "claim",
    title: input.title ?? input.key!,
    created: todayIso,
    key: input.key!,
    confidence: input.confidence ?? 0.7,
    last_validated: todayIso,
    profile,
    move,
    scope_wiki,
    tags,
    evidence: input.evidence ?? [],
    status: "active",
    supersedes: [(existing as { id: string }).id],
    superseded_by: null,
    retracted_at: null,
    retracted_by: null,
    retraction_reason: null,
    wiki,
    summary: input.title ?? input.key!,
    updated: todayIso,
    authored_by: input.as,
  };
  await store.write(vaultPath, newFm, input.body ?? "");

  // 2. Mark the existing one superseded. Re-read for fresh mtime to satisfy
  //    `update`'s OCC contract.
  const fresh = await store.read(vaultPath, (existing as { id: string }).id);
  if (!fresh) throw new Error(`existing claim ${(existing as { id: string }).id} disappeared mid-supersede`);
  await store.update(
    vaultPath,
    (existing as { id: string }).id,
    { status: "superseded", superseded_by: newId, updated: todayIso },
    fresh.mtime,
  );

  return {
    claim_id: newId,
    action: "superseded",
    superseded_id: (existing as { id: string }).id,
    reindex_recommended: true,
  };
}

async function revalidateAction(
  store: ClaimsStore,
  vaultPath: string,
  existing: Awaited<ReturnType<ClaimsStore["read"]>> & object,
  input: ClaimToolInput,
  todayIso: string,
): Promise<ClaimToolResult> {
  const fresh = await store.read(vaultPath, (existing as { id: string }).id);
  if (!fresh) throw new Error(`existing claim ${(existing as { id: string }).id} disappeared mid-revalidate`);
  const patch: Partial<ClaimFrontmatter> = {
    last_validated: todayIso,
    updated: todayIso,
  };
  if (typeof input.confidence === "number") {
    patch.confidence = input.confidence;
  }
  await store.update(vaultPath, fresh.id, patch, fresh.mtime);
  return {
    claim_id: fresh.id,
    action: "revalidated",
    reindex_recommended: true,
  };
}

async function retractAction(
  store: ClaimsStore,
  vaultPath: string,
  claimId: string,
  as: string,
  reason: string,
  todayIso: string,
): Promise<ClaimToolResult> {
  const target = await store.read(vaultPath, claimId);
  if (!target) throw new Error(`no such claim ${claimId} to retract`);
  if (target.authored_by !== as) {
    throw new Error(
      `only the original author may retract claim ${claimId}: authored_by=${target.authored_by ?? "<unset>"}, as=${as}`,
    );
  }
  await store.update(
    vaultPath,
    claimId,
    {
      status: "retracted",
      retracted_at: todayIso,
      retracted_by: as,
      retraction_reason: reason,
      updated: todayIso,
    },
    target.mtime,
  );
  return {
    claim_id: claimId,
    action: "retracted",
    reindex_recommended: true,
  };
}

function rejectionResponse(
  existing: Awaited<ReturnType<ClaimsStore["read"]>> & object,
  existingEffective: number,
  yourConfidence: number,
): ClaimToolResult {
  const ex = existing as { id: string };
  return {
    claim_id: ex.id, // surface the existing one so the agent can read it
    action: "rejected",
    rejection: {
      reason:
        `existing claim ${ex.id} has effective confidence ` +
        `${existingEffective.toFixed(3)}; submission's ${yourConfidence} is not strictly higher`,
      existing_id: ex.id,
      existing_effective_confidence: existingEffective,
      your_confidence: yourConfidence,
      suggestion:
        "pass `override: true` to force supersession, or fetch newer evidence and re-submit at higher confidence",
    },
    reindex_recommended: true,
  };
}
