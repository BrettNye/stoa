// vault-mcp/src/core/claims.ts
//
// task-claims-store — single-writer CRUD over claim pages. Atomic writes via
// tmp+rename (mirrors the rationale in `core/index-locking.ts` for sidecar RMW).
// Frontmatter is serialized via `gray-matter`, but ISO date values are passed
// through as strings so the §v1.5 friction T3-5 lesson holds (no Date-in,
// Date-out surprises).
//
// Plan reference:
// `wikis/_meta/plans/2026-05-02-vault-mcp-claims-plan-1-foundation-dag.md`
// §task-claims-store.

import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { ClaimFrontmatter } from "../types/claim.js";
import { ClaimDraft, parseClaim } from "../types/claim.js";
import { scopeHash } from "./scope-hash.js";

export interface ParsedClaim extends ClaimFrontmatter {
  body: string;
  filePath: string;
  /** ISO timestamp from `fs.stat().mtime`. Used for OCC on `update`. */
  mtime: string;
}

export class MtimeConflictError extends Error {
  constructor(public claimId: string) {
    super(`Stale mtime for ${claimId}`);
    this.name = "MtimeConflictError";
  }
}

export class ClaimsStore {
  /**
   * Read a single claim by id. Returns `null` for non-existent or malformed
   * files (defensive: a corrupt claim should not poison `findByIdentity`'s
   * scan-all path).
   */
  async read(vaultPath: string, claimId: string): Promise<ParsedClaim | null> {
    const file = await this.findById(vaultPath, claimId);
    if (!file) return null;
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = matter(raw);
      if (!parsed.data || Object.keys(parsed.data).length === 0) return null;
      // Reads are tolerant of partial-tier fixtures: parse via `ClaimDraft`
      // (which makes wiki/summary/updated/authored_by optional regardless of
      // status). Strict tier enforcement is the responsibility of `write` /
      // `update` (and a future `vault.lint` pass on existing claims).
      const fm = ClaimDraft.parse(this.normalizeIsoDates(parsed.data)) as ClaimFrontmatter;
      const stat = await fs.stat(file);
      return {
        ...fm,
        body: parsed.content,
        filePath: file,
        mtime: stat.mtime.toISOString(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Find an active claim whose `(key, scope_hash)` identity matches.
   *
   * The scope_hash is recomputed from the candidate's `(profile, move,
   * scope_wiki, tags)` arrays via `scopeHash` — this is the spec-canonical
   * identity over a claim's scope dimensions. Superseded and retracted claims
   * are skipped so a fresh one with the same identity can co-exist on disk.
   */
  async findByIdentity(
    vaultPath: string,
    key: string,
    scope_hash: string,
  ): Promise<ParsedClaim | null> {
    const all = await this.scanAll(vaultPath);
    for (const c of all) {
      if (c.status !== "active") continue;
      if (c.key !== key) continue;
      if (scopeHash(c.profile, c.move, c.scope_wiki, c.tags) !== scope_hash) continue;
      return c;
    }
    return null;
  }

  /**
   * Find every active claim whose `profile:` array contains `profileId`.
   * Multi-profile claims (the array has length > 1) are included; superseded
   * and retracted claims are excluded.
   */
  async findAllByProfile(vaultPath: string, profileId: string): Promise<ParsedClaim[]> {
    const all = await this.scanAll(vaultPath);
    return all.filter((c) => c.status === "active" && c.profile.includes(profileId));
  }

  /**
   * Write a brand-new claim. Refuses to overwrite — callers must use
   * `update()` for in-place edits. Validates the frontmatter at the matching
   * tier via `parseClaim` before writing.
   */
  async write(vaultPath: string, fm: ClaimFrontmatter, body: string): Promise<void> {
    parseClaim(fm); // validate-on-write
    const wiki = fm.wiki ?? "_agents";
    const file = path.join(vaultPath, "wikis", wiki, "claim", `${fm.id}.md`);
    const exists = await fs
      .access(file)
      .then(() => true)
      .catch(() => false);
    if (exists) throw new Error(`Refusing to overwrite ${fm.id}; use update()`);
    const out = matter.stringify(body, fm as unknown as Record<string, unknown>);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.atomicWrite(file, out);
  }

  /**
   * Patch a claim's frontmatter. The merged shape is re-validated through
   * `parseClaim`, so e.g. transitioning to `superseded` requires
   * `superseded_by` to be present in the patch.
   *
   * `expectedMtime` MUST equal the `mtime` returned by the most recent
   * `read()`; a stale value throws `MtimeConflictError`. This is the same OCC
   * pattern used by `core/pages.ts` (which keys off `updated:` rather than
   * filesystem mtime — claims use mtime because they don't carry a separate
   * write-counter field).
   */
  async update(
    vaultPath: string,
    claimId: string,
    patch: Partial<ClaimFrontmatter>,
    expectedMtime: string,
  ): Promise<void> {
    const current = await this.read(vaultPath, claimId);
    if (!current) throw new Error(`No such claim ${claimId}`);
    if (current.mtime !== expectedMtime) throw new MtimeConflictError(claimId);
    // Strip the helper fields off `current` before merging — they are not
    // frontmatter, they are read-side decoration.
    const { body: _b, filePath: _f, mtime: _m, ...currentFm } = current;
    const merged = { ...currentFm, ...patch } as ClaimFrontmatter;
    parseClaim(merged); // validate post-patch shape (e.g. superseded → superseded_by required)
    const out = matter.stringify(current.body, merged as unknown as Record<string, unknown>);
    await this.atomicWrite(current.filePath, out);
  }

  // ---- private helpers ----

  /** Locate a claim file by id across all wikis. Returns null if not found. */
  private async findById(vaultPath: string, id: string): Promise<string | null> {
    const wikisDir = path.join(vaultPath, "wikis");
    const wikis = await this.listDir(wikisDir);
    for (const wiki of wikis) {
      const file = path.join(wikisDir, wiki, "claim", `${id}.md`);
      const exists = await fs
        .access(file)
        .then(() => true)
        .catch(() => false);
      if (exists) return file;
    }
    return null;
  }

  /**
   * Scan every wiki's `claim/` folder. Malformed files are silently skipped
   * (they would also fail a future `lint` pass; the store does not enforce
   * here because `findByIdentity` is on a hot read path).
   */
  private async scanAll(vaultPath: string): Promise<ParsedClaim[]> {
    const out: ParsedClaim[] = [];
    const wikisDir = path.join(vaultPath, "wikis");
    const wikis = await this.listDir(wikisDir);
    for (const wiki of wikis) {
      const dir = path.join(wikisDir, wiki, "claim");
      const entries = await this.listDir(dir);
      for (const entry of entries) {
        if (!entry.endsWith(".md")) continue;
        const file = path.join(dir, entry);
        try {
          const raw = await fs.readFile(file, "utf8");
          const parsed = matter(raw);
          if (!parsed.data || Object.keys(parsed.data).length === 0) continue;
          // Same tolerance as `read()` — see the rationale there.
          const fm = ClaimDraft.parse(this.normalizeIsoDates(parsed.data)) as ClaimFrontmatter;
          const stat = await fs.stat(file);
          out.push({
            ...fm,
            body: parsed.content,
            filePath: file,
            mtime: stat.mtime.toISOString(),
          });
        } catch {
          // skip malformed
        }
      }
    }
    return out;
  }

  /**
   * Atomic file write via tmp+rename. The temp filename is sibling to the
   * destination (same dir → same filesystem → POSIX atomic rename). On
   * Windows, `fs.rename` is also atomic when source and destination are on
   * the same volume; we ignore the cross-volume case (claims always land
   * inside the vault tree).
   */
  private async atomicWrite(file: string, content: string): Promise<void> {
    const dir = path.dirname(file);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(
      dir,
      `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
    );
    try {
      await fs.writeFile(tmp, content, "utf8");
      await fs.rename(tmp, file);
    } catch (err) {
      // Best-effort cleanup of the tmp on failure.
      await fs.unlink(tmp).catch(() => {});
      throw err;
    }
  }

  private async listDir(dir: string): Promise<string[]> {
    try {
      return await fs.readdir(dir);
    } catch {
      return [];
    }
  }

  /**
   * gray-matter parses unquoted YAML date scalars (e.g. `created: 2026-05-02`)
   * into JS `Date` objects. The Zod schema in `types/claim.ts` requires
   * strings via `IsoDate`, so we normalize Date values back to `YYYY-MM-DD`
   * here. The shared test helpers use `JSON.stringify` which already produces
   * quoted strings; this guard exists for defensiveness against hand-authored
   * frontmatter and for round-trip safety after `matter.stringify`.
   */
  private normalizeIsoDates(raw: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...raw };
    for (const k of ["created", "last_validated", "updated", "retracted_at"]) {
      const v = out[k];
      if (v instanceof Date) out[k] = v.toISOString().slice(0, 10);
    }
    return out;
  }
}
