import matter from "gray-matter";
import { z } from "zod";

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

export const NoteType = z.enum([
  "idea", "question", "spec", "decision", "concept",
  "guide", "synthesis", "source", "map", "journal", "task",
  "move", "profile", "trainer"
]);
export type NoteType = z.infer<typeof NoteType>;

export const PokemonType = z.enum([
  "normal", "fire", "water", "electric", "grass", "ice", "fighting",
  "poison", "ground", "flying", "psychic", "bug", "rock", "ghost",
  "dragon", "dark", "steel", "fairy"
]);
export type PokemonType = z.infer<typeof PokemonType>;

export const EvolutionStage = z.enum(["basic", "stage1", "stage2"]);
export type EvolutionStage = z.infer<typeof EvolutionStage>;

export const AutonomyLevel = z.enum(["restricted", "feature-branch", "main-branch"]);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

export const MoveCategory = z.enum(["process", "capability", "domain", "support"]);
export type MoveCategory = z.infer<typeof MoveCategory>;

export const PageStatus = z.enum([
  "draft", "active", "accepted", "superseded", "archived"
]);
export type PageStatus = z.infer<typeof PageStatus>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

// 2026-05-08 substrate-adoption W1.3 — optional triage signal on draft pages,
// set by the authoring subagent (or human) to indicate how much human attention
// the draft deserves. See `[[wikis/_meta/concepts/concept-curation-priority]]`.
// Validated when present; absent means "unset" (`MISSING_CURATION_PRIORITY`
// lint warning fires on aging agent-authored drafts).
export const CurationPriority = z.enum(["high", "medium", "low"]);
export type CurationPriority = z.infer<typeof CurationPriority>;

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const draftSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  type: NoteType,
  created: z.string().regex(ISO_DATE),
  channel: z.string().regex(KEBAB).optional(),
  // Optional triage signal — when present, must be one of the enum values.
  // Used by curator subagents (e.g., profile-slowking) and the
  // MISSING_CURATION_PRIORITY lint rule to drive human attention budget.
  curation_priority: CurationPriority.optional()
}).passthrough();

const activeSchema = draftSchema.extend({
  wiki: z.string().regex(KEBAB),
  status: PageStatus,
  summary: z.string().min(1),
  updated: z.string().regex(ISO_DATE)
});

const acceptedSchema = activeSchema.extend({
  tags: z.array(z.string()).default([]),
  related: z.array(z.string()).default([])
});

export type Frontmatter = z.infer<typeof draftSchema>;

export interface ParsedPage {
  frontmatter: Record<string, any>;
  body: string;
}

export function parseFrontmatter(raw: string): ParsedPage {
  const parsed = matter(raw);
  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    throw new FrontmatterError("missing or empty frontmatter");
  }
  return { frontmatter: parsed.data, body: parsed.content };
}

export function serializeFrontmatter(
  frontmatter: Record<string, any>,
  body: string
): string {
  return matter.stringify(body, frontmatter);
}

export function validateAtTier(
  frontmatter: Record<string, any>,
  tier: "draft" | "active" | "accepted"
): void {
  const schema =
    tier === "draft"    ? draftSchema :
    tier === "active"   ? activeSchema :
                          acceptedSchema;
  const result = schema.safeParse(frontmatter);
  if (!result.success) {
    const msgs = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new FrontmatterError(`tier "${tier}" validation: ${msgs}`);
  }
  if (tier === "accepted" && frontmatter.type === "decision" && !frontmatter.confidence) {
    throw new FrontmatterError(`accepted decision requires confidence`);
  }

  // v1.5 — move type validation
  if (frontmatter.type === "move") {
    if (tier === "draft" || tier === "active" || tier === "accepted") {
      if (!frontmatter.name || typeof frontmatter.name !== "string") {
        throw new FrontmatterError(`move requires 'name' field (SKILL.md spec)`);
      }
    }
    if (tier === "active" || tier === "accepted") {
      if (!frontmatter.description || typeof frontmatter.description !== "string") {
        throw new FrontmatterError(`active move requires 'description' field (SKILL.md spec)`);
      }
      if (frontmatter.pokemon_type && !PokemonType.safeParse(frontmatter.pokemon_type).success) {
        throw new FrontmatterError(`move pokemon_type must be one of 18 canonical types`);
      }
    }
  }

  // v1.5 — profile type validation
  if (frontmatter.type === "profile") {
    if (tier === "active" || tier === "accepted") {
      if (!PokemonType.safeParse(frontmatter.pokemon_type).success) {
        throw new FrontmatterError(`active profile requires valid pokemon_type (18-canon)`);
      }
      if (!EvolutionStage.safeParse(frontmatter.evolution_stage).success) {
        throw new FrontmatterError(`active profile requires evolution_stage in [basic,stage1,stage2]`);
      }
      if (!Array.isArray(frontmatter.moveset)) {
        throw new FrontmatterError(`active profile requires moveset array`);
      }
    }
  }
}

/**
 * Normalize a frontmatter date-ish value to an ISO date string ("YYYY-MM-DD").
 *
 * gray-matter parses unquoted YAML dates (e.g. `created: 2026-04-28`) into JS
 * Date objects. Use this anywhere you need to compare/serialize a frontmatter
 * date as a string. Returns `""` for null/undefined.
 */
export function toIsoDate(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
