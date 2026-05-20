import { existsSync, readFileSync, writeFileSync } from "node:fs";

export type McpServerEntry = {
  command: string;
  args: string[];
  env?: Record<string, string>;
};

export function upsertMcpServer(
  settingsPath: string,
  name: string,
  entry: McpServerEntry
): void {
  let current: { mcpServers?: Record<string, McpServerEntry> } & Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf8");
    const trimmed = raw.trim();
    if (trimmed !== "") {
      try {
        current = JSON.parse(trimmed);
      } catch (err) {
        throw new Error(
          `malformed JSON in settings file "${settingsPath}": ${(err as Error).message}`
        );
      }
    }
  }
  current.mcpServers = current.mcpServers ?? {};
  current.mcpServers[name] = entry;
  writeFileSync(settingsPath, JSON.stringify(current, null, 2) + "\n", "utf8");
}
