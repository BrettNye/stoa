import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { syncMoveset } from "../core/skills.js";
import { readProfile, ProfileNotFoundError } from "../core/profiles.js";
import { loadActiveProfileClaims } from "../core/claim-clustering.js";
import {
  rankClaimsForDeployingProfile,
  formatClaimBullet,
} from "../core/claim-render.js";
import { getClaimsConfig, type ClaimsConfig } from "../config.js";

const Input = z.object({
  repo_path: z.string(),
  wiki: z.string(),
  pokemon: z.string().optional(),
  channels: z.array(z.string()).optional(),
  mcp_server_name: z.string().default("vault")
});

const BOOTSTRAP_MARKER_START = "<!-- vault-mcp v1.5 bootstrap:start -->";
const BOOTSTRAP_MARKER_END = "<!-- /vault-mcp-bootstrap -->";

/**
 * Claims spec §8.3 — when a profile is being deployed into the repo, render
 * its profile-only learnings (claims with `move == []`) as a marker-bounded
 * section co-located inside the v1.5 bootstrap fragment. Returns null when
 * zero claims qualify so the caller can omit markers entirely (the §8.3
 * acceptance criteria forbid empty markers).
 */
async function renderProfileLearnedSection(args: {
  vaultPath: string;
  profileId: string;
  today: Date;
  config: ClaimsConfig;
}): Promise<string | null> {
  const all = await loadActiveProfileClaims(
    args.vaultPath,
    args.profileId,
    args.today,
    args.config,
  );
  // §8.3 filter: claim.move == [] (profile-scoped, not move-specific).
  const profileOnly = all.filter((c) => (c.move ?? []).length === 0);
  if (profileOnly.length === 0) return null;
  const ranked = rankClaimsForDeployingProfile(
    profileOnly,
    args.profileId,
    args.today,
    args.config,
  );
  const top = ranked.slice(0, args.config.render_default_limit);
  const renderDate = args.today.toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(
    `<!-- vault-claims-profile:start (rendered: ${renderDate}, half-life: ${args.config.half_life_days}d) -->`,
  );
  lines.push("## Learned (this profile)");
  lines.push("");
  for (const c of top) lines.push(formatClaimBullet(c, args.today, args.config));
  lines.push("");
  lines.push(
    `*If \`vault-claims-profile rendered:\` is more than ${args.config.staleness_warn_days} days old, run \`vault.bootstrap-repo\` again to refresh.*`,
  );
  lines.push(`<!-- vault-claims-profile:end -->`);
  return lines.join("\n");
}

async function buildClaudeMdFragment(args: {
  repoPath: string;
  wiki: string;
  serverName: string;
  pokemon?: string;
  channels?: string[];
  profile?: { name: string; title: string; pokemon_type: string; evolution_stage: string; canonical_id: string };
  vaultPath: string;
  today: Date;
  claimsConfig: ClaimsConfig;
}): Promise<string> {
  const lines: string[] = [];
  lines.push(BOOTSTRAP_MARKER_START);
  lines.push("");
  lines.push(`## Vault context — wiki: \`${args.wiki}\``);
  lines.push("");
  lines.push(`Working directory: \`${args.repoPath}\` (verify your CWD matches before tool calls).`);
  lines.push("");
  lines.push(`This repo is bootstrapped to the knowledge vault. The MCP server is registered under the name \`${args.serverName}\`; vault tools are exposed as \`mcp__${args.serverName}__vault_*\` (e.g. \`mcp__${args.serverName}__vault_start\`).`);
  lines.push("");
  lines.push("On every session start:");
  lines.push("");
  lines.push(`1. Call \`vault.start\` (via \`mcp__${args.serverName}__vault_start\`) — reads the wiki map, tails active channels, runs \`vault.recall\` on the repo's primary topic, returns a context brief.`);
  lines.push(`2. Journal at end-of-task: call \`vault.agent-journal\` with \`moves_used:\` populated when applicable.`);
  if (args.channels && args.channels.length > 0) {
    lines.push(`3. Tail and post on these channels: ${args.channels.map(c => `\`${c}\``).join(", ")}.`);
  }
  if (args.profile) {
    lines.push("");
    lines.push(`### Operating as: **${args.profile.title}** (${args.profile.pokemon_type} / ${args.profile.evolution_stage})`);
    lines.push("");
    lines.push(`Skills are deployed under \`.claude/skills/${args.profile.name}/\`. Read the moveset's SKILL.md files for behavioral guidance.`);

    // §8.3 — render the deploying profile's profile-only learnings.
    const learned = await renderProfileLearnedSection({
      vaultPath: args.vaultPath,
      profileId: args.profile.canonical_id,
      today: args.today,
      config: args.claimsConfig,
    });
    if (learned) {
      lines.push("");
      lines.push(learned);
    }
  }
  lines.push("");
  lines.push(BOOTSTRAP_MARKER_END);
  return lines.join("\n");
}

function mergeOrAppendClaudeMd(repoPath: string, fragment: string): string {
  const path = join(repoPath, "CLAUDE.md");
  if (!existsSync(path)) {
    writeFileSync(path, fragment + "\n");
    return path;
  }
  const existing = readFileSync(path, "utf8");
  if (existing.includes(BOOTSTRAP_MARKER_START)) {
    // Replace existing block
    const before = existing.split(BOOTSTRAP_MARKER_START)[0];
    const after = existing.split(BOOTSTRAP_MARKER_END)[1] ?? "";
    writeFileSync(path, before + fragment + after);
  } else {
    // Append
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(path, existing + sep + fragment + "\n");
  }
  return path;
}

function mergeOrCreateMcpJson(repoPath: string, vaultPath: string, wiki: string, serverName: string): string {
  const mcpJsonPath = join(repoPath, ".mcp.json");
  const tsxBinaryName = process.platform === "win32" ? "tsx.cmd" : "tsx";
  const vaultMcpDir = join(vaultPath, "vault-mcp").replace(/\\/g, "/");
  const tsxBinary = join(vaultPath, "vault-mcp", "node_modules", ".bin", tsxBinaryName).replace(/\\/g, "/");
  const binTs = join(vaultPath, "vault-mcp", "src", "bin.ts").replace(/\\/g, "/");
  const vaultEntry = {
    command: tsxBinary,
    args: [
      binTs,
      "--mcp",
      `--vault=${vaultPath.replace(/\\/g, "/")}`,
      `--default-wiki=${wiki}`
    ],
    cwd: vaultMcpDir
  };

  if (!existsSync(mcpJsonPath)) {
    writeFileSync(mcpJsonPath, JSON.stringify({ mcpServers: { [serverName]: vaultEntry } }, null, 2) + "\n");
    return mcpJsonPath;
  }

  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(mcpJsonPath, "utf8"));
  } catch (e) {
    throw new Error(`existing .mcp.json at ${mcpJsonPath} is not valid JSON: ${(e as Error).message}`);
  }

  if (typeof parsed !== "object" || parsed === null) parsed = {};
  if (typeof parsed.mcpServers !== "object" || parsed.mcpServers === null) {
    parsed.mcpServers = {};
  }
  parsed.mcpServers[serverName] = vaultEntry;

  writeFileSync(mcpJsonPath, JSON.stringify(parsed, null, 2) + "\n");
  return mcpJsonPath;
}

export const bootstrapRepoTool = {
  name: "vault.bootstrap-repo",
  description: "Wire a repo to the vault MCP: writes .mcp.json + CLAUDE.md fragment; optionally deploys a Pokemon's moveset.",
  inputSchema: Input,
  handler: async (
    input: z.infer<typeof Input>,
    ctx: {
      vaultPath: string;
      // Claims Plan 3 Wave 2 — clock injection + raw vault config pass-through.
      // Both optional so DispatchCtx (which carries an optional rawConfig) is
      // structurally assignable. `today` defaults to `new Date()` when omitted;
      // tests should always inject for deterministic outputs.
      today?: Date;
      rawConfig?: unknown;
    }
  ) => {
    const serverName = (input.mcp_server_name as string | undefined) ?? "vault";
    const today = ctx.today ?? new Date();
    const claimsConfig = getClaimsConfig(ctx.rawConfig ?? {});
    mkdirSync(input.repo_path, { recursive: true });

    // Write .mcp.json (merge — preserves existing mcpServers entries)
    const mcpJsonPath = mergeOrCreateMcpJson(input.repo_path, ctx.vaultPath, input.wiki, serverName);

    // Resolve profile if given
    let profileSummary:
      | { name: string; title: string; pokemon_type: string; evolution_stage: string; canonical_id: string }
      | undefined;
    if (input.pokemon) {
      try {
        const p = readProfile(ctx.vaultPath, input.pokemon);
        const slug = input.pokemon.startsWith("profile-") ? input.pokemon.slice("profile-".length) : input.pokemon;
        // Canonical id from frontmatter when present (alias-resolved); fall
        // back to a normalized form of the input. The §8.3 loader needs the
        // full `profile-<slug>` key that claims store in `c.profile`.
        const canonicalId = String(p.frontmatter.id ?? (input.pokemon.startsWith("profile-") ? input.pokemon : `profile-${input.pokemon}`));
        profileSummary = {
          name: slug,
          title: String(p.frontmatter.title ?? slug),
          pokemon_type: String(p.frontmatter.pokemon_type ?? "normal"),
          evolution_stage: String(p.frontmatter.evolution_stage ?? "basic"),
          canonical_id: canonicalId
        };
      } catch (e) {
        if (e instanceof ProfileNotFoundError) {
          throw new Error(`PROFILE_NOT_FOUND: ${input.pokemon}`);
        }
        throw e;
      }
    }

    // Build + write CLAUDE.md
    const fragment = await buildClaudeMdFragment({
      repoPath: input.repo_path,
      wiki: input.wiki,
      serverName,
      pokemon: input.pokemon,
      channels: input.channels,
      profile: profileSummary,
      vaultPath: ctx.vaultPath,
      today,
      claimsConfig
    });
    const claudeMdPath = mergeOrAppendClaudeMd(input.repo_path, fragment);

    const filesWritten = [mcpJsonPath, claudeMdPath];

    // Optionally sync moveset
    let movesetSynced: { skills_dir: string; moves: string[] } | null = null;
    if (input.pokemon) {
      const sync = syncMoveset({
        vaultPath: ctx.vaultPath,
        repoPath: input.repo_path,
        pokemon_id: input.pokemon,
        target: "claude-code",
        mode: "symlink"
      });
      movesetSynced = { skills_dir: sync.skills_dir, moves: sync.moves_synced };
    }

    return {
      files_written: filesWritten,
      moveset_synced: movesetSynced,
      channels_configured: input.channels ?? []
    };
  }
};
