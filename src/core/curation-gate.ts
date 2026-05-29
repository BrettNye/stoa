import type { CurationAction, Confidence } from "./curation-rule.js";
import type { CurationConfig } from "../config.js";

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

export function gateActions(
  actions: CurationAction[],
  config: CurationConfig,
): CurationAction[] {
  const floor = RANK[config.confidence_floor];
  return actions.map((a) => {
    // Rule already held it back via flag_reason — preserve as-is but ensure applies:false
    if (a.flag_reason) return { ...a, applies: false };

    // Confidence floor check
    if (RANK[a.confidence] < floor)
      return {
        ...a,
        applies: false,
        flag_reason: `below confidence floor (${a.confidence})`,
      };

    // Human-authored archive scope rule
    if (
      a.to_status === "archived" &&
      a.author_class === "human" &&
      !config.auto_archive_human
    )
      return {
        ...a,
        applies: false,
        flag_reason: "archive candidate — human-authored, your call",
      };

    // All gates cleared — unconditionally apply
    return { ...a, applies: true };
  });
}
