import { z } from "zod";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { syncMoveset } from "../core/skills.js";
import { readProfile, ProfileNotFoundError } from "../core/profiles.js";

const Input = z.object({
  repo_path: z.string(),
  wiki: z.string(),
  pokemon: z.string().optional(),
  channels: z.array(z.string()).optional(),
  mcp_server_name: z.string().default("vault")
});

const BOOTSTRAP_MARKER_START = "<!-- vault-mcp v1.5 bootstrap:start -->";
const BOOTSTRAP_MARKER_END = "<!-- /vault-mcp-bootstrap -->";

function buildClaudeMdFragment(args: {
  repoPath: string;
  wiki: string;
  serverName: string;
  pokemon?: string;
  channels?: string[];
  profile?: { name: string; title: string; pokemon_type: string; evolution_stage: string };
}): string {
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
  handler: async (input: z.infer<typeof Input>, ctx: { vaultPath: string }) => {
    const serverName = (input.mcp_server_name as string | undefined) ?? "vault";
    mkdirSync(input.repo_path, { recursive: true });

    // Write .mcp.json (merge — preserves existing mcpServers entries)
    const mcpJsonPath = mergeOrCreateMcpJson(input.repo_path, ctx.vaultPath, input.wiki, serverName);

    // Resolve profile if given
    let profileSummary: { name: string; title: string; pokemon_type: string; evolution_stage: string } | undefined;
    if (input.pokemon) {
      try {
        const p = readProfile(ctx.vaultPath, input.pokemon);
        const slug = input.pokemon.startsWith("profile-") ? input.pokemon.slice("profile-".length) : input.pokemon;
        profileSummary = {
          name: slug,
          title: String(p.frontmatter.title ?? slug),
          pokemon_type: String(p.frontmatter.pokemon_type ?? "normal"),
          evolution_stage: String(p.frontmatter.evolution_stage ?? "basic")
        };
      } catch (e) {
        if (e instanceof ProfileNotFoundError) {
          throw new Error(`PROFILE_NOT_FOUND: ${input.pokemon}`);
        }
        throw e;
      }
    }

    // Build + write CLAUDE.md
    const fragment = buildClaudeMdFragment({
      repoPath: input.repo_path,
      wiki: input.wiki,
      serverName,
      pokemon: input.pokemon,
      channels: input.channels,
      profile: profileSummary
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
