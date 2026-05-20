// v1.7 §7.2 — SUBAGENT_DEF_INVARIANT_VIOLATION
//
// Walks _index/deployments.json entries with subagent_def_path; opens each
// on-disk agent definition file; verifies invariants 1-5 (severity error)
// and 6 (severity warning).
//
// Source of truth is the on-disk artifact, NOT the current profile + moveset.
// Profile drift is what `vault_sync-agents` re-deploy is for, governed by
// source_revision (invariant 5). This check answers: "is the deployed
// artifact still well-formed and not blocked by user policy?"

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { registerLintCheck } from "../lint-check.js";
import { readDeployments } from "../deployments.js";
import { MINIMAL_COORDINATION_TOOLSET, mcpToolName } from "../subagent-protocol.js";
import type { Diagnostic } from "../lint.js";

interface SettingsJson {
  permissions?: { allow?: string[]; deny?: string[] };
}

function readSettings(target: string): SettingsJson | null {
  const p = join(target, ".claude", "settings.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function permissionMatches(pattern: string, toolName: string): boolean {
  if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
  return pattern === toolName;
}

registerLintCheck({
  code: "SUBAGENT_DEF_INVARIANT_VIOLATION",
  run(ctx, _idx, _input) {
    const diagnostics: Diagnostic[] = [];
    const reg = readDeployments(ctx.vaultPath);

    for (const profileId of Object.keys(reg)) {
      const entries = reg[profileId] ?? [];
      for (const entry of entries) {
        if (!entry.subagent_def_path) continue;  // pre-v1.7 entries skipped
        const path = entry.subagent_def_path;
        if (!existsSync(path)) {
          diagnostics.push({
            severity: "error",
            code: "SUBAGENT_DEF_INVARIANT_VIOLATION",
            page_id: profileId,
            wiki: "_agents",
            message: `deployed agent def missing on disk: ${path} (invariant 4)`,
            suggestion: `re-run vault_sync-agents ${profileId.replace(/^profile-/, "")} --target=${entry.repo_path}`,
          });
          continue;
        }

        const raw = readFileSync(path, "utf8");

        // Invariant 1 — every coordination tool present.
        for (const t of MINIMAL_COORDINATION_TOOLSET) {
          const wire = mcpToolName(t);
          if (!raw.includes(`- ${wire}`)) {
            diagnostics.push({
              severity: "error",
              code: "SUBAGENT_DEF_INVARIANT_VIOLATION",
              page_id: profileId,
              wiki: "_agents",
              message: `agent def at ${path} missing coordination tool ${wire} (invariant 1)`,
              suggestion: `re-run vault_sync-agents ${profileId.replace(/^profile-/, "")} --target=${entry.repo_path}`,
            });
          }
        }

        // Invariant 2 — protocol block embedded.
        if (!raw.includes("## Channel/journal protocol")) {
          diagnostics.push({
            severity: "error",
            code: "SUBAGENT_DEF_INVARIANT_VIOLATION",
            page_id: profileId,
            wiki: "_agents",
            message: `agent def at ${path} missing ## Channel/journal protocol section (invariant 2)`,
            suggestion: `re-run vault_sync-agents ${profileId.replace(/^profile-/, "")} --target=${entry.repo_path}`,
          });
        }

        // Invariant 5 — source_revision recorded.
        if (!entry.source_revision) {
          diagnostics.push({
            severity: "error",
            code: "SUBAGENT_DEF_INVARIANT_VIOLATION",
            page_id: profileId,
            wiki: "_agents",
            message: `deployment registry entry for ${profileId} → ${entry.repo_path} has no source_revision (invariant 5)`,
            suggestion: `re-run vault_sync-agents to record the current revision`,
          });
        }

        // Invariant 6 — settings.json permission conflicts.
        const settings = readSettings(entry.repo_path);
        if (settings?.permissions?.deny?.length) {
          // Re-derive the wire-form tool names from the on-disk tools: list.
          // Cheap regex extraction; not worth a full YAML parse for a lint check.
          const toolLines = raw.match(/^\s*-\s+\S+/gm) ?? [];
          const tools = toolLines.map(l => l.replace(/^\s*-\s+/, "").trim());
          const conflicts: string[] = [];
          for (const t of tools) {
            for (const deny of settings.permissions.deny!) {
              if (permissionMatches(deny, t)) { conflicts.push(t); break; }
            }
          }
          if (conflicts.length) {
            diagnostics.push({
              severity: "warning",
              code: "SUBAGENT_DEF_INVARIANT_VIOLATION",
              page_id: profileId,
              wiki: "_agents",
              message: `target ${entry.repo_path} settings.json denies ${conflicts.length} agent tool(s): ${conflicts.join(", ")} (invariant 6)`,
              suggestion: `update <target>/.claude/settings.json to allow these tools, or accept the runtime fall-through to permission prompts`,
            });
          }
        }
      }
    }

    return diagnostics;
  }
});
