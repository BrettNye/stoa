// v1.7 §6.5 — Claude Code RuntimeAdapter.
//
// Output: <target>/.claude/agents/<pokemon-id>.md
// File shape: yaml frontmatter (name/description/tools/model) +
// system-prompt body + ## Channel/journal protocol + ## Moveset.
//
// Permission-conflict surfacing reads <target>/.claude/settings.json's
// permissions.deny[] (invariant 6, severity warning, NOT auto-modified).

import {
  existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import yaml from "js-yaml";
import {
  CHANNEL_JOURNAL_PROTOCOL_GUIDANCE,
  MINIMAL_COORDINATION_TOOLSET,
  mcpToolName,
} from "../subagent-protocol.js";
import {
  recordDeployment, getDeployment, type DeploymentEntry,
} from "../deployments.js";
import type {
  RuntimeAdapter, SubagentIntent, ValidationResult, SerializedFiles,
  DeployOptions, DeployResult, VerifyResult, RemoveResult, ValidationDiagnostic,
} from "./types.js";

function agentFileRelative(intent: SubagentIntent): string {
  // Forward slashes: this is a cross-platform storage key for SerializedFiles,
  // not an OS path. join(target, rel) below normalizes for the filesystem.
  return `.claude/agents/${intent.id}.md`;
}

function readSettingsJson(target: string): { permissions?: { allow?: string[]; deny?: string[] } } | null {
  const p = join(target, ".claude", "settings.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function permissionMatches(pattern: string, toolName: string): boolean {
  // Glob support for "mcp__vault__vault_*" style entries.
  if (pattern.endsWith("*")) {
    return toolName.startsWith(pattern.slice(0, -1));
  }
  return pattern === toolName;
}

function detectPermissionConflicts(
  intent: SubagentIntent,
  target: string
): ValidationDiagnostic[] {
  const settings = readSettingsJson(target);
  if (!settings?.permissions?.deny) return [];
  const denies = settings.permissions.deny;
  const conflicts: string[] = [];
  for (const tool of intent.tools_allowlist) {
    const wireName = mcpToolName(tool);
    for (const deny of denies) {
      if (permissionMatches(deny, wireName)) {
        conflicts.push(wireName);
        break;
      }
    }
  }
  if (conflicts.length === 0) return [];
  return [{
    invariant: 6,
    message: `target settings.json denies ${conflicts.length} tool(s) in the agent's allowlist`,
    context: { conflicting_tools: conflicts, settings_path: join(target, ".claude", "settings.json") },
  }];
}

export const claudeCodeAdapter: RuntimeAdapter = {
  name: "claude-code",

  async validate(intent, target) {
    const errors: ValidationDiagnostic[] = [];
    const warnings: ValidationDiagnostic[] = [];

    // §6.4 invariant 3 — applies_to gate.
    if (!intent.applies_to.includes("claude-code")) {
      errors.push({
        invariant: 3,
        message: `intent.applies_to (${JSON.stringify(intent.applies_to)}) does not include "claude-code"`,
      });
    }

    // Target writability.
    if (!existsSync(target)) {
      errors.push({
        invariant: 4,
        message: `target path does not exist: ${target}`,
      });
    } else {
      try {
        const st = statSync(target);
        if (!st.isDirectory()) {
          errors.push({ invariant: 4, message: `target is not a directory: ${target}` });
        }
      } catch (e: any) {
        errors.push({ invariant: 4, message: `cannot stat target: ${e.message}` });
      }
    }

    // §6.4 invariant 1 — toolset baseline (pre-serialize check on the intent).
    for (const t of MINIMAL_COORDINATION_TOOLSET) {
      if (!intent.tools_allowlist.includes(t)) {
        errors.push({
          invariant: 1,
          message: `tools_allowlist missing coordination tool ${t}`,
        });
      }
    }

    // §6.4 invariant 6 — permission-conflict surfacing.
    if (existsSync(target)) {
      warnings.push(...detectPermissionConflicts(intent, target));
    }

    return { ok: errors.length === 0, errors, warnings };
  },

  serialize(intent) {
    const fmObj = {
      name: intent.id,
      description: intent.routing_description,
      tools: intent.tools_allowlist.map(mcpToolName),
      model: intent.model_tier,
    };
    const fmYaml = yaml.dump(fmObj, { lineWidth: 1000, noRefs: true }).trimEnd();

    const moveset = intent.moveset.map(m =>
      `### ${m.title}\n${m.summary}\n\n**When to use:** ${m.applicability}`
    ).join("\n\n");

    const content = [
      "---",
      fmYaml,
      "---",
      "",
      intent.system_prompt.trimEnd(),
      "",
      "## Channel/journal protocol",
      "",
      CHANNEL_JOURNAL_PROTOCOL_GUIDANCE,
      "",
      "## Moveset",
      "",
      moveset || "(no moveset)",
      "",
    ].join("\n");

    return { [agentFileRelative(intent)]: content };
  },

  async deploy(intent, target, opts) {
    // §6.4 invariant 5 — idempotent re-deploy via source_revision.
    const existing = getDeployment(opts.registry_path, intent.id, target);
    if (existing && existing.source_revision === intent.source_revision) {
      const absPath = join(target, agentFileRelative(intent));
      // Defensive: if the registry says deployed but the file was hand-removed,
      // proceed with deploy rather than returning skipped against a missing file.
      if (existsSync(absPath)) {
        return {
          files_written: [absPath],
          status: "skipped-no-change",
          source_revision: intent.source_revision,
        };
      }
    }

    const files = this.serialize(intent);
    const written: string[] = [];
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(target, rel);
      if (existsSync(abs) && !opts.overwrite && !existing) {
        throw new Error(`agent def already exists at ${abs}; pass overwrite: true to replace`);
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      written.push(abs);
    }

    const entry: DeploymentEntry = {
      repo_path: target,
      target: "claude-code",
      mode: opts.mode,
      actual_mode: opts.mode,
      runtime: "claude-code",
      source_revision: intent.source_revision,
      subagent_def_path: written[0],
      synced_at: new Date().toISOString(),
    };
    recordDeployment(opts.registry_path, intent.id, entry);

    return { files_written: written, status: "deployed", source_revision: intent.source_revision };
  },

  async verify(intent, target) {
    const violations: ValidationDiagnostic[] = [];
    const abs = join(target, agentFileRelative(intent));
    if (!existsSync(abs)) {
      return { ok: false, violations: [{ invariant: 4, message: `agent def missing at ${abs}` }] };
    }
    const raw = readFileSync(abs, "utf8");

    // §6.4 invariant 1 — every coordination tool present in tools: list.
    for (const t of MINIMAL_COORDINATION_TOOLSET) {
      const wire = mcpToolName(t);
      if (!raw.includes(`- ${wire}`)) {
        violations.push({
          invariant: 1,
          message: `on-disk agent def missing coordination tool ${wire}`,
          context: { agent_def_path: abs, missing_tool: wire },
        });
      }
    }

    // §6.4 invariant 2 — protocol block embedded.
    if (!raw.includes("## Channel/journal protocol")) {
      violations.push({
        invariant: 2,
        message: "on-disk agent def missing ## Channel/journal protocol section",
        context: { agent_def_path: abs },
      });
    }

    // §6.4 invariant 5 — source_revision recorded in the registry.
    const entry = getDeployment(target, intent.id, target);  // registry is at vaultPath, not target
    // (Note: full registry-side check lives in the lint check, which has access
    // to the vault path. verify() is target-relative; we pin invariants 1/2
    // here and let the lint check round-trip the registry.)

    return { ok: violations.length === 0, violations };
  },

  async remove(intent, target) {
    const removed: string[] = [];
    const abs = join(target, agentFileRelative(intent));
    if (existsSync(abs)) {
      unlinkSync(abs);
      removed.push(abs);
    }
    // Note: registry entry removal is handled by the caller (vault.sync-agents
    // or a future vault.remove-agent tool) — adapter.remove() is filesystem-only.
    return { files_removed: removed };
  },
};
