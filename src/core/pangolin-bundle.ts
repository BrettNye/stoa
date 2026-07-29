import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";

/** One item as it appears in a pangolin audit export. */
export interface BundleItem {
  id: string;
  status: string;
  /** Absent when the item produced no patch — e.g. a dispatch that paused for input. */
  resultRef?: string;
  outputRefs?: Record<string, string>;
  /** Worker self-verify outcome. `passed: false` on a `done` item is "done-but-red". */
  verify?: { passed?: boolean };
}

/** Parse an audit bundle written by `pangolin orch audit --out`. */
export function readBundleItems(bundlePath: string): BundleItem[] {
  const raw = JSON.parse(readFileSync(bundlePath, "utf8")) as { items?: unknown };
  return Array.isArray(raw.items) ? (raw.items as BundleItem[]) : [];
}

/**
 * Map a content-addressed ref to its on-disk blob path.
 * `pangolin://<ns>/<type>/<name>/<hash>` -> `<root>/<ns>/<type>/<name>/<hash>.blob`
 * Returns null for a ref that is not in that form (e.g. a dispatch-record URI).
 */
export function resolveBlobPath(ref: string, storageRoot: string): string | null {
  const m = /^pangolin:\/\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(ref);
  if (!m) return null;
  const [, ns, type, name, hash] = m;
  if ([ns, type, name, hash].some((s) => s === "." || s === ".." || s.includes("\\"))) return null;
  const root = resolve(storageRoot);
  const candidate = resolve(root, ns, type, name, `${hash}.blob`);
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

/** Read a ref's bytes as UTF-8. Returns null when unresolvable or unreadable — never throws. */
export function readBlob(ref: string, storageRoot: string): string | null {
  const path = resolveBlobPath(ref, storageRoot);
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
