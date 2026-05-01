import { existsSync, mkdirSync, openSync, closeSync, unlinkSync } from "node:fs";
import { join } from "node:path";

/**
 * v1.7 §5.2/§5.3 — Serialize concurrent RMW on the index sidecars using
 * atomic-rename-with-retry semantics. The lock file is `_index/.locks/<sidecar>.lock`
 * and is created with O_EXCL; conflicts retry with exponential backoff.
 *
 * Spec §5.2 leaves the choice between advisory lock and atomic-rename-with-retry
 * to the implementation. This module implements the atomic-rename-with-retry
 * strategy because OS-level advisory locks (`proper-lockfile` and similar)
 * interact poorly with antivirus and file watchers in some Windows configurations.
 *
 * Lock scope is per-sidecar (passed in `sidecarKeys`). Multi-sidecar locks
 * (used by reindex) acquire keys in lexicographic order to prevent deadlock.
 *
 * @param vaultPath  vault root
 * @param sidecarKeys  e.g. ["pages.json"] for upsertPage, or ["pages.json","tokens.json","wikis.json","links.json"] for reindex
 * @param fn  the read-modify-write block; lock held for its duration
 */
export async function withSerializedIndexWrite<T>(
  vaultPath: string,
  sidecarKeys: string[],
  fn: () => T | Promise<T>
): Promise<T> {
  const locksDir = join(vaultPath, "_index", ".locks");
  if (!existsSync(locksDir)) mkdirSync(locksDir, { recursive: true });

  // Sort to prevent deadlock under multi-sidecar acquisition.
  const sortedKeys = [...sidecarKeys].sort();
  const lockPaths = sortedKeys.map(k => join(locksDir, `${k}.lock`));
  const acquired: string[] = [];

  const MAX_RETRIES = 200;        // ~10s at 50ms backoff
  const RETRY_DELAY_MS = 50;

  try {
    for (const lockPath of lockPaths) {
      let attempts = 0;
      while (true) {
        try {
          // O_EXCL + O_CREAT — fails if file already exists.
          const fd = openSync(lockPath, "wx");
          closeSync(fd);
          acquired.push(lockPath);
          break;
        } catch (e: any) {
          if (e.code !== "EEXIST") throw e;
          attempts++;
          if (attempts >= MAX_RETRIES) {
            throw new Error(`withSerializedIndexWrite: could not acquire lock on ${lockPath} after ${MAX_RETRIES} retries`);
          }
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    return await fn();
  } finally {
    for (const lockPath of acquired) {
      try { unlinkSync(lockPath); } catch { /* ignore */ }
    }
  }
}
