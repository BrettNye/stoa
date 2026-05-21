import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type SyncFolder = {
  name: string;
  path: string;
  detected_via: "default-location" | "env-var";
};

const DEFAULT_CANDIDATES = [
  { name: "Dropbox", subdir: "Dropbox" },
  { name: "OneDrive", subdir: "OneDrive" },
  { name: "Google Drive", subdir: "Google Drive" },
  { name: "iCloud Drive", subdir: "iCloud Drive" },
  { name: "Box", subdir: "Box" },
];

// `platform` is currently unread — reserved for future per-OS gating
// (e.g. iCloud Drive on darwin only, OneDrive Business pattern on win32).
// Kept in the signature so adding the gating later isn't a breaking change.
export function detectSyncFolders(home: string, platform: NodeJS.Platform): SyncFolder[] {
  const found: SyncFolder[] = [];
  for (const c of DEFAULT_CANDIDATES) {
    const p = join(home, c.subdir);
    if (existsSync(p)) found.push({ name: c.name, path: p, detected_via: "default-location" });
  }
  // OneDrive Business: ~/OneDrive - <Tenant>
  if (existsSync(home)) {
    try {
      const entries = readdirSync(home);
      for (const e of entries) if (e.startsWith("OneDrive - ")) {
        found.push({ name: e, path: join(home, e), detected_via: "default-location" });
      }
    } catch { /* unreadable home → fall through */ }
  }
  return found;
}
