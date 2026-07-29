// src/core/four-section.ts
//
// Owns the one definition of the four-section task format — rendering a
// concern record into a markdown body, and parsing that body back into its
// sections. Render and parse are inverses of a single format; keeping them
// in one module is what stops the emitter and the consumer from drifting.

/** One concern as emitted in the `outputs/concerns` envelope. */
export interface Concern {
  title: string;
  files: string[];
  scope: string;
  out_of_scope: string;
  verification: string;
}

/** The versioned envelope written to `outputs/concerns`. */
export interface ConcernsEnvelope {
  schemaVersion: 1;
  concerns: Concern[];
}

export const CONCERNS_SCHEMA_VERSION = 1;

/** Validate an unknown parsed blob as a ConcernsEnvelope. Returns [] of errors; empty = valid. */
export function validateEnvelope(v: unknown): string[] {
  const errs: string[] = [];
  const e = v as Partial<ConcernsEnvelope> | null;
  if (!e || typeof e !== "object") return ["envelope is not an object"];
  if (e.schemaVersion !== CONCERNS_SCHEMA_VERSION)
    errs.push(`unsupported schemaVersion ${String(e.schemaVersion)} (expected ${CONCERNS_SCHEMA_VERSION})`);
  if (!Array.isArray(e.concerns)) errs.push("concerns must be an array");
  return errs;
}

/** Render a concern into the four-section markdown body stoa's readiness gate recognises. */
export function renderFourSection(c: Concern): string {
  return [
    `# ${c.title}`,
    ``,
    `## Scope`,
    c.scope,
    ``,
    `Files: ${c.files.join(", ")}`,
    ``,
    `## Out of scope`,
    c.out_of_scope,
    ``,
    `## Verification`,
    c.verification,
    ``,
  ].join("\n");
}

/** Extract a named `## ` section's body text. Returns "" when absent. */
export function parseFourSection(body: string, heading: string): string {
  const re = new RegExp(`(?:^|\\n)##\\s+${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const m = re.exec(body);
  return m ? m[1].trim() : "";
}
