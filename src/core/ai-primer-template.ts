import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type PrimerInputs = {
  role: "engineering" | "sales" | "marketing" | "leadership" | "other";
  interaction_mode: "passive" | "active";
  team_mode: boolean;
  vault_path: string;
  wiki_names: string[];
};

export const PRIMER_MARKER_START = "<!-- stoa-primer:start -->";
export const PRIMER_MARKER_END = "<!-- /stoa-primer -->";

export function renderPrimer(inputs: PrimerInputs): string {
  const lines: string[] = [];
  lines.push(PRIMER_MARKER_START);
  lines.push("");
  lines.push("# Stoa is wired up on this machine");
  lines.push("");
  lines.push(`Vault: \`${inputs.vault_path}\``);
  lines.push(`Wikis: ${inputs.wiki_names.map((n) => "`" + n + "`").join(", ") || "(none yet)"}`);
  lines.push("");
  lines.push("## When to reach for tools (reflex rules)");
  lines.push("");
  lines.push("| User intent signal | Tool to call |");
  lines.push("|---|---|");
  lines.push("| \"save this\" / \"remember\" | vault_inbox |");
  lines.push("| \"what did we figure out about X\" | vault_recall |");
  lines.push("| User makes a verbal decision | propose vault_new(decision) |");
  lines.push("| 3+ pages on same topic | propose vault_synthesize |");
  lines.push("| You don't know what to do next | vault_orient |");
  lines.push("");
  lines.push(`## Filing discipline (${inputs.interaction_mode})`);
  lines.push("");
  lines.push(
    inputs.interaction_mode === "passive"
      ? "Pick a type and file. Don't ask the user 'idea or question?' — just pick the better fit. Default to inbox if uncertain."
      : "When filing, propose the type to the user before writing. 'Sounds like a decision — file it as one?'"
  );
  lines.push("");
  lines.push(`## Role context: ${inputs.role}`);
  lines.push(roleBlock(inputs.role));
  if (inputs.team_mode) {
    lines.push("");
    lines.push("## Team etiquette");
    lines.push("- vault_recall BEFORE writing — avoid duplicating teammates' work.");
    lines.push("- channels = team comms; journals = personal.");
    lines.push("- Don't run /process-inbox without checking volume — others may have items in flight.");
  }
  lines.push("");
  lines.push("## When you're unsure");
  lines.push("Call `vault_orient`. It returns the next best action given current vault state.");
  lines.push("");
  lines.push(PRIMER_MARKER_END);
  return lines.join("\n");
}

function roleBlock(role: PrimerInputs["role"]): string {
  switch (role) {
    case "engineering": return "Tags: architecture, bug, refactor, perf, api. Look for: tech-choice decisions, postmortems, gotchas.";
    case "sales":       return "Tags: account, objection, playbook, deal. Look for: customer quotes, recurring objections, won/lost reasons.";
    case "marketing":   return "Tags: campaign, copy, audience, positioning. Look for: messaging that worked, content angles.";
    case "leadership":  return "Tags: roadmap, hiring, culture, oneOnOne. Look for: decisions, people notes, strategic tradeoffs.";
    default:            return "Tags: (set per-wiki). Look for: anything the user might want recalled later.";
  }
}

export function writePrimerToUserScope(userMdPath: string, primerContent: string): void {
  let existing = "";
  if (existsSync(userMdPath)) existing = readFileSync(userMdPath, "utf8");
  const startIdx = existing.indexOf(PRIMER_MARKER_START);
  const endIdx = existing.indexOf(PRIMER_MARKER_END);
  let next: string;
  if (startIdx >= 0 && endIdx > startIdx) {
    next = existing.slice(0, startIdx) + primerContent + existing.slice(endIdx + PRIMER_MARKER_END.length);
  } else {
    next = existing + (existing.endsWith("\n") || existing === "" ? "" : "\n") + "\n" + primerContent + "\n";
  }
  writeFileSync(userMdPath, next, "utf8");
}
