import { existsSync } from "node:fs";
import { join } from "node:path";

export type ClientName = "claude-code" | "cursor" | "codex";

export type DetectedClient = {
  client: ClientName;
  config_dir: string;
  settings_path: string;
  user_md_path: string;
};

const PLATFORM_PATHS: Record<ClientName, (home: string, platform: NodeJS.Platform) => DetectedClient> = {
  "claude-code": (home, _platform) => {
    const dir = join(home, ".claude");
    return { client: "claude-code", config_dir: dir, settings_path: join(dir, "settings.json"), user_md_path: join(dir, "CLAUDE.md") };
  },
  cursor: (home) => {
    const dir = join(home, ".cursor");
    return { client: "cursor", config_dir: dir, settings_path: join(dir, "mcp.json"), user_md_path: join(dir, "rules", "stoa.mdc") };
  },
  codex: (home) => {
    const dir = join(home, ".config", "codex");
    return { client: "codex", config_dir: dir, settings_path: join(dir, "config.json"), user_md_path: join(dir, "CODEX.md") };
  },
};

// `platform` is currently unread — reserved for future per-OS path variations
// (e.g. Claude Desktop config moves under `~/Library/Application Support/` on
// darwin and `%APPDATA%/` on win32). Kept in the signature so adding the
// per-OS branches later isn't a breaking change.
export function detectClients(home: string, platform: NodeJS.Platform): DetectedClient[] {
  const all: DetectedClient[] = (Object.keys(PLATFORM_PATHS) as ClientName[]).map((k) => PLATFORM_PATHS[k](home, platform));
  return all.filter((c) => existsSync(c.config_dir));
}
