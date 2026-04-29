import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function appendLog(
  vaultPath: string,
  wiki: string,
  workflow: string,
  actor: string,
  message: string
): void {
  const logPath = join(vaultPath, "wikis", wiki, "log.md");
  if (!existsSync(logPath)) {
    writeFileSync(
      logPath,
      `# ${wiki} — operations log\n\nAppend-only chronological record. Each entry: ISO timestamp, workflow, actor, message.\n\n`
    );
  }
  const ts = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const entry = `- ${ts} \`${workflow}\` by ${actor}: ${message}\n`;
  appendFileSync(logPath, entry);
}
