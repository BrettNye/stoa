// v1.7 §6.4 — Cross-runtime coordination protocol primitives.
//
// Two canonical constants used by every RuntimeAdapter:
//
//   MINIMAL_COORDINATION_TOOLSET — the 10-tool baseline every Pokemon receives
//   so it can claim its own task, post and tail a channel, journal end-of-task,
//   read prior context, and close the agent-memory feedback loop. Missing any
//   of these is a hard error per invariant 1.
//
//   CHANNEL_JOURNAL_PROTOCOL_GUIDANCE — the canned ~200-word block embedded
//   verbatim in every system prompt's "## Channel/journal protocol" section.
//   Behavioral distinctiveness comes from the per-Pokemon system_prompt and
//   moveset; this block is mechanical (§12.3 decision: canned for v1.7).

import type { ToolName } from "./runtime-adapters/types.js";

export const MINIMAL_COORDINATION_TOOLSET: readonly ToolName[] = Object.freeze([
  "vault_task-claim",
  "vault_task-list",
  "vault_task-update",
  "vault_channel-post",
  "vault_channel-tail",
  "vault_agent-journal",
  "vault_recall",
  "vault_read",
  "vault_agent-memory",  // closes the read side of the agent-memory feedback loop
  "vault_claim",          // closes the write side of the agent-memory feedback loop
]);

export const CHANNEL_JOURNAL_PROTOCOL_GUIDANCE = `\
You coordinate with other agents through the vault, not through filesystem watching or shared memory.

**Before starting work.** Claim your task atomically with vault_task-claim --as=<your-id>. If you see AlreadyClaimedError, another agent took it — surface that to your dispatcher and stop. Once claimed, post a single "ready to begin" message to your declared coordination channel using vault_channel-post so peers see you're live.

**During work.** Periodically call vault_channel-tail with since=<your-cursor> to pick up signals from peers. The cursor is the value returned by your previous tail call; persist it in session memory and pass it back next time. On cold start, pass the ISO timestamp of your task claim as since= and you will receive every message since you started.

**Ending work.** When your task is complete, post a ready signal to the channel in this format: branch=<branch-token> pr=<pr-number>. The merge orchestrator (Mewtwo) consumes these signals to build its merge queue. Then journal end-of-task with vault_agent-journal --channel=<channel> --entry="..." — the journal records what you did, which moves you used, and any open questions for follow-up agents.

**Vault-of-record caveat.** vault-mcp always reads from and writes to the main worktree's vault root. If you are running inside a per-agent git worktree, do NOT watch your worktree's filesystem for coordination signals — use vault_channel-tail. Your worktree filesystem is invisible to peers.`;

// Render a tool name as the wire-form an MCP client (e.g. Claude Code) sees in
// its agent tool list. MCP tool names are prefixed by the SERVER name (the
// key in `.mcp.json`'s `mcpServers` map), not by the tool surface or vendor.
// Older callers hardcoded `mcp__vault__`; that assumed the user had registered
// stoa under the literal name `vault`. Users can register stoa under any name
// (`stoa`, `stoa-dev`, `my-stoa`, etc), and the on-disk agent files MUST match
// or the dispatched subagent will see an empty MCP tool surface.
//
// Resolution order: explicit `serverName` arg → `STOA_MCP_SERVER_NAME` env var
// → "vault" default. The env-var path lets users set `env.STOA_MCP_SERVER_NAME`
// in their `.mcp.json` once, and all sync-agents / lint / verify flows
// automatically use the right prefix without further plumbing.
export function mcpToolName(toolName: ToolName, serverName?: string): string {
  if (!toolName || typeof toolName !== "string") {
    throw new Error(`mcpToolName: invalid input ${JSON.stringify(toolName)}`);
  }
  const name = serverName ?? process.env.STOA_MCP_SERVER_NAME ?? "vault";
  if (toolName.startsWith("vault_")) {
    return `mcp__${name}__${toolName}`;
  }
  return toolName;
}

/**
 * Returns a RegExp that matches the wire form of `toolName` under ANY MCP
 * server-name prefix. Used by lint + verify when scanning an existing on-disk
 * agent file — those files were written with whatever serverName was active at
 * deploy time, which may not match what the current lint/verify caller knows.
 *
 * Matches the literal `mcp__<servername>__<toolName>` shape; `<servername>`
 * conforms to MCP's `^[a-zA-Z0-9_-]+$` server-name grammar.
 */
export function mcpToolNamePattern(toolName: ToolName): RegExp {
  if (!toolName || typeof toolName !== "string") {
    throw new Error(`mcpToolNamePattern: invalid input ${JSON.stringify(toolName)}`);
  }
  if (!toolName.startsWith("vault_")) {
    // Non-vault tools (Bash, WebSearch, etc) don't carry an mcp__ prefix.
    return new RegExp(`(?:^|[\\s,\\-])${escapeRegExp(toolName)}(?:$|[\\s,])`);
  }
  return new RegExp(`mcp__[a-zA-Z0-9_-]+__${escapeRegExp(toolName)}`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
