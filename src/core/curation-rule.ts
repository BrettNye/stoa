import type { NoteType } from "./frontmatter.js";
import type { CurationConfig } from "../config.js";

export type Confidence = "high" | "medium" | "low";

export interface CandidatePage {
  page_id: string; wiki: string; type: NoteType; path: string; // vault-relative
  status: string; author_class: "agent" | "human";
  created?: string; updated?: string; inbound_link_count: number;
  frontmatter: Record<string, unknown>; // implementation, related, supersedes, resolved_by, summary, tags, confidence
}

export interface CurationAction {
  code: string; page_id: string; wiki: string;
  from_status: string; to_status: string; // active|accepted|archived|superseded|resolved
  evidence: string; confidence: Confidence;
  author_class: "agent" | "human";
  field_patch?: Record<string, unknown>;
  applies?: boolean;         // gate sets the final value; rules may leave unset (treated as not-yet-decided)
  flag_reason?: string;
}

export interface CurationCtx {
  vaultPath: string; today: Date; config: CurationConfig;
  candidates: CandidatePage[];
  // git I/O injected as a function; the pure contract does not import the I/O
  // module (curate-git.ts), so it carries no dependency on it. The orchestrator
  // supplies curate-git's verifyPrMerged, which is structurally compatible.
  verifyPrMerged: (ref: string) => "merged" | "open" | "unknown";
}

export interface CurationRule { code: string; run(ctx: CurationCtx): CurationAction[]; }

export const curationRuleRegistry: CurationRule[] = [];
export function registerCurationRule(r: CurationRule): void { curationRuleRegistry.push(r); }
export function runRegisteredRules(ctx: CurationCtx): CurationAction[] {
  return curationRuleRegistry.flatMap(r => r.run(ctx));
}
