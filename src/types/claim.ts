import { z } from "zod";

export const ClaimStatus = z.enum(["draft", "active", "superseded", "retracted"]);
export type ClaimStatus = z.infer<typeof ClaimStatus>;

const KeyPattern = /^[a-z0-9-]+(\.[a-z0-9-]+){1,3}$/;
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Base = z.object({
  id: z.string().regex(/^claim-/),
  type: z.literal("claim"),
  title: z.string().min(1),
  created: IsoDate,
  key: z.string().regex(KeyPattern),
  confidence: z.number().min(0).max(1),
  last_validated: IsoDate,

  // scope (always arrays; absent → []) — preprocess to coerce
  profile: z.preprocess((v) => v ?? [], z.array(z.string()).default([])),
  move: z.preprocess((v) => v ?? [], z.array(z.string()).default([])),
  scope_wiki: z.preprocess((v) => v ?? [], z.array(z.string()).default([])),
  tags: z.preprocess((v) => v ?? [], z.array(z.string()).default([])),

  evidence: z.preprocess((v) => v ?? [], z.array(z.string()).default([])),
  status: ClaimStatus,

  // supersession
  supersedes: z.preprocess((v) => v ?? [], z.array(z.string()).default([])),
  superseded_by: z.string().nullable().default(null),

  // retraction
  retracted_at: IsoDate.nullable().default(null),
  retracted_by: z.string().nullable().default(null),
  retraction_reason: z.string().nullable().default(null),

  // standard vault fm
  wiki: z.string().optional(),
  summary: z.string().optional(),
  updated: IsoDate.optional(),
  authored_by: z.string().optional(),
});

export const ClaimDraft = Base.partial({
  wiki: true,
  summary: true,
  updated: true,
  authored_by: true,
});

export const ClaimActive = Base.extend({
  status: z.literal("active"),
  wiki: z.string(),
  summary: z.string().min(1),
  updated: IsoDate,
  authored_by: z.string(),
});

export const ClaimSuperseded = ClaimActive.extend({
  status: z.literal("superseded"),
  superseded_by: z.string().min(1), // required when superseded
});

export const ClaimRetracted = ClaimActive.extend({
  status: z.literal("retracted"),
  retracted_at: IsoDate,
  retracted_by: z.string(),
  retraction_reason: z.string().min(1),
});

export type ClaimFrontmatter = z.infer<typeof Base>;

export function parseClaim(input: unknown): ClaimFrontmatter {
  const draft = ClaimDraft.parse(input);
  switch (draft.status) {
    case "draft":
      return draft;
    case "active":
      return ClaimActive.parse(input);
    case "superseded":
      return ClaimSuperseded.parse(input);
    case "retracted":
      return ClaimRetracted.parse(input);
  }
}
