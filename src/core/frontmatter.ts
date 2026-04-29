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
  "guide", "synthesis", "source", "map", "journal", "task"
]);
export type NoteType = z.infer<typeof NoteType>;

export const PageStatus = z.enum([
  "draft", "active", "accepted", "superseded", "archived"
]);
export type PageStatus = z.infer<typeof PageStatus>;

export const Confidence = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof Confidence>;

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const draftSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  type: NoteType,
  created: z.string().regex(ISO_DATE),
  channel: z.string().regex(KEBAB).optional()
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
}
