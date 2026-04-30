// Cross-platform skills-deploy primitives.
//
// This module is the SINGLE home for `symlinkSync`/`cpSync`/`process.platform`
// branches in vault-mcp's skills pipeline. Wave 2 of v1.6 Phase 1 will refactor
// `core/skills.ts` to call into here; until then, this module exists as a pure
// helpers layer with no production callers.
//
// Spec: wikis/_meta/specs/2026-04-30-vault-mcp-v1.6-design.md §3.1, §5.4, §6.2
// Plan: wikis/_meta/plans/2026-04-30-vault-mcp-v1.6-phase-1-friction-paydown.md (T1-2)
//
// Windows note: directory symlinks normally require admin privilege, but
// `fs.symlinkSync(target, dest, "junction")` does not — junctions are reported
// by `lstatSync(dest).isSymbolicLink()` as `true` so callers don't need to
// branch on platform when checking the result. We default to `"junction"` on
// win32 and `"dir"` elsewhere.

import * as fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";

export type DeployMode = "copy" | "symlink";

const SYMLINK_FALLBACK_CODES: ReadonlySet<string> = new Set([
  "EPERM",
  "EACCES",
  "EEXIST",
  // Windows occasionally surfaces UNKNOWN when the process lacks the
  // SeCreateSymbolicLinkPrivilege right; treat it the same as EPERM.
  "UNKNOWN"
]);

function symlinkType(): "junction" | "dir" {
  return process.platform === "win32" ? "junction" : "dir";
}

/**
 * Test seam. The `node:fs` ESM namespace is frozen, so `vi.spyOn(fs, ...)`
 * cannot redefine its members. Production code routes filesystem mutations
 * through this shim so tests can `vi.spyOn(_internals, "...")` deterministically.
 *
 * Not part of the public API. Don't import from outside tests.
 */
export const _internals = {
  symlinkSync: (target: string, path: string, type: "junction" | "dir"): void => {
    fs.symlinkSync(target, path, type);
  },
  cpSync: (src: string, dest: string): void => {
    fs.cpSync(src, dest, { recursive: true });
  },
  unlinkSync: (path: string): void => {
    fs.unlinkSync(path);
  },
  readFileSync: (path: string): Buffer => {
    return fs.readFileSync(path);
  }
};

/**
 * Probe whether the host can create directory symlinks rooted at `targetDir`.
 *
 * Builds a sentinel symlink `<targetDir>/.symlink-probe-<rand>` pointing at
 * `targetDir` itself; cleans up on success; returns `true` on success, `false`
 * on any thrown error.
 *
 * Used by `vault.sync-skills` to write `actual_mode` truthfully into
 * `_index/deployments.json` (spec §5.4).
 */
export function probeSymlinkSupport(targetDir: string): boolean {
  const probePath = join(targetDir, `.symlink-probe-${randomBytes(6).toString("hex")}`);
  try {
    _internals.symlinkSync(targetDir, probePath, symlinkType());
  } catch {
    return false;
  }
  // Cleanup. If unlink fails, swallow: leaving a probe behind is preferable
  // to throwing from a probe.
  try {
    _internals.unlinkSync(probePath);
  } catch {
    // intentional no-op
  }
  return true;
}

/**
 * Deploy a single move's source directory to its dest path.
 *
 * Behaviour:
 *  - `requested === "symlink"`: try `fs.symlinkSync(srcDir, destDir, type)`.
 *    On EPERM/EACCES/EEXIST/UNKNOWN, fall back to recursive copy and report
 *    `actual_mode: "copy"`. Other errors re-throw.
 *  - `requested === "copy"`: recursive `fs.cpSync` and report `actual_mode: "copy"`.
 *
 * Caller's responsibility: `destDir`'s parent must exist. This function does
 * NOT create the parent.
 */
export function deployMove(
  srcDir: string,
  destDir: string,
  requested: DeployMode
): { actual_mode: DeployMode } {
  if (requested === "symlink") {
    try {
      _internals.symlinkSync(srcDir, destDir, symlinkType());
      return { actual_mode: "symlink" };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !SYMLINK_FALLBACK_CODES.has(code)) {
        throw err;
      }
      // fall through to copy
    }
  }
  _internals.cpSync(srcDir, destDir);
  return { actual_mode: "copy" };
}

/**
 * SHA-256 hex digest of file bytes.
 *
 * Used by drift detection to compare deployed move bytes against the canonical
 * vault source. Throws on missing file (ENOENT propagates from readFileSync).
 */
export function computeFileHash(path: string): string {
  return createHash("sha256").update(_internals.readFileSync(path)).digest("hex");
}

export interface DriftReport {
  deployment_path: string;
  move_id: string;
  kind: "missing" | "hash-mismatch";
  expected_hash: string;
  actual_hash?: string; // undefined when kind === "missing"
}

export interface DriftMoveExpectation {
  /** The move's id (e.g. `move-tdd-cycle`). */
  id: string;
  /** SHA-256 hex digest of the canonical source file bytes (vault-side). */
  expected_hash: string;
  /**
   * Path to the file under `deployment.skills_dir`, relative.
   * Typically `<move-id>/SKILL.md`.
   */
  relative_path: string;
}

export interface DriftDeployment {
  /** Absolute path to the deployment's skills dir on the consumer side. */
  skills_dir: string;
  moves: DriftMoveExpectation[];
}

/**
 * Detect drift between a deployment's on-disk skill files and their expected hashes.
 *
 * For each move:
 *  - If the file at `<skills_dir>/<relative_path>` is missing, emit
 *    `{ kind: "missing", actual_hash: undefined }`.
 *  - If its SHA-256 differs from `expected_hash`, emit
 *    `{ kind: "hash-mismatch", actual_hash: <observed> }`.
 *  - Otherwise emit nothing.
 *
 * NOTE on input shape: the v1.5 `_index/deployments.json` schema (per
 * `core/deployments.ts`) does NOT yet carry per-move `expected_hash` or
 * `relative_path`. Wave 2 (T2-2/T2-3) is responsible for extending
 * `DeploymentEntry` to record those fields at sync-time, and for assembling
 * the `DriftDeployment` input from the registry plus the vault's canonical
 * move sources. Until then this helper accepts a structurally explicit input
 * that callers build directly.
 *
 * `vaultPath` is accepted for forward compatibility (e.g. once consumers
 * resolve canonical hashes by path). It is not currently dereferenced by
 * this helper but is part of the contract so the call sites don't have to
 * change again in Wave 2.
 */
export function detectDriftAt(
  deployment: DriftDeployment,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  vaultPath: string
): DriftReport[] {
  const reports: DriftReport[] = [];
  for (const move of deployment.moves) {
    const filePath = join(deployment.skills_dir, move.relative_path);
    let actualHash: string;
    try {
      actualHash = computeFileHash(filePath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        reports.push({
          deployment_path: deployment.skills_dir,
          move_id: move.id,
          kind: "missing",
          expected_hash: move.expected_hash,
          actual_hash: undefined
        });
        continue;
      }
      throw err;
    }
    if (actualHash !== move.expected_hash) {
      reports.push({
        deployment_path: deployment.skills_dir,
        move_id: move.id,
        kind: "hash-mismatch",
        expected_hash: move.expected_hash,
        actual_hash: actualHash
      });
    }
  }
  return reports;
}
