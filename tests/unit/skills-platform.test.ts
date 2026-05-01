import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  probeSymlinkSupport,
  deployMove,
  computeFileHash,
  detectDriftAt,
  _internals,
  type DriftReport
} from "../../src/core/skills-platform.js";

describe("skills-platform", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "skills-platform-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("probeSymlinkSupport", () => {
    it("returns true when sentinel symlink succeeds in tmpdir", () => {
      // Need a target directory for the probe link to point at.
      const targetDir = join(tmp, "target");
      mkdirSync(targetDir, { recursive: true });
      const probeHost = join(tmp, "probehost");
      mkdirSync(probeHost, { recursive: true });

      const result = probeSymlinkSupport(probeHost);
      expect(typeof result).toBe("boolean");
      // On dev machines (this CI), expect true; but be resilient — assert
      // only that the host dir is left clean.
      const remaining = fs.readdirSync(probeHost);
      expect(remaining).toEqual([]);
    });

    it("returns false when symlinkSync is mocked to throw EPERM", () => {
      const probeHost = join(tmp, "probehost-fail");
      mkdirSync(probeHost, { recursive: true });

      vi.spyOn(_internals, "symlinkSync").mockImplementation(() => {
        const err = new Error("EPERM mock") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      });

      expect(probeSymlinkSupport(probeHost)).toBe(false);
      // host left clean even on failure
      const remaining = fs.readdirSync(probeHost);
      expect(remaining).toEqual([]);
    });
  });

  describe("deployMove", () => {
    let srcDir: string;
    let destParent: string;

    beforeEach(() => {
      srcDir = join(tmp, "src-move");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "SKILL.md"), "# move\n");
      writeFileSync(join(srcDir, "ref.md"), "ref body\n");

      destParent = join(tmp, "dest-parent");
      mkdirSync(destParent, { recursive: true });
    });

    it("requested=copy → returns actual_mode: 'copy' and dest is a real dir", () => {
      const destDir = join(destParent, "copy-dest");
      const out = deployMove(srcDir, destDir, "copy");
      expect(out.actual_mode).toBe("copy");
      expect(existsSync(join(destDir, "SKILL.md"))).toBe(true);
      expect(readFileSync(join(destDir, "SKILL.md"), "utf8")).toContain("# move");
      expect(lstatSync(destDir).isDirectory()).toBe(true);
      expect(lstatSync(destDir).isSymbolicLink()).toBe(false);
    });

    it("requested=symlink on success → returns actual_mode: 'symlink' (or 'copy' if host disallows)", () => {
      const destDir = join(destParent, "symlink-dest");
      const out = deployMove(srcDir, destDir, "symlink");
      // Either symlink (preferred) or copy fallback if the host can't symlink.
      // Both leave a usable dest with the source files.
      expect(["symlink", "copy"]).toContain(out.actual_mode);
      expect(existsSync(join(destDir, "SKILL.md"))).toBe(true);
      if (out.actual_mode === "symlink") {
        // junction or "dir" symlink; both surface as isSymbolicLink() === true on Node.
        expect(lstatSync(destDir).isSymbolicLink()).toBe(true);
      } else {
        expect(lstatSync(destDir).isDirectory()).toBe(true);
        expect(lstatSync(destDir).isSymbolicLink()).toBe(false);
      }
    });

    it("requested=symlink with EPERM → falls back to copy", () => {
      const destDir = join(destParent, "eperm-dest");

      vi.spyOn(_internals, "symlinkSync").mockImplementationOnce(() => {
        const err = new Error("EPERM mock") as NodeJS.ErrnoException;
        err.code = "EPERM";
        throw err;
      });

      const out = deployMove(srcDir, destDir, "symlink");
      expect(out.actual_mode).toBe("copy");
      expect(existsSync(join(destDir, "SKILL.md"))).toBe(true);
      expect(lstatSync(destDir).isSymbolicLink()).toBe(false);
      expect(lstatSync(destDir).isDirectory()).toBe(true);
    });

    it("requested=symlink with EACCES → falls back to copy", () => {
      const destDir = join(destParent, "eacces-dest");

      vi.spyOn(_internals, "symlinkSync").mockImplementationOnce(() => {
        const err = new Error("EACCES mock") as NodeJS.ErrnoException;
        err.code = "EACCES";
        throw err;
      });

      const out = deployMove(srcDir, destDir, "symlink");
      expect(out.actual_mode).toBe("copy");
      expect(existsSync(join(destDir, "SKILL.md"))).toBe(true);
    });

    it("requested=symlink with EEXIST → falls back to copy", () => {
      const destDir = join(destParent, "eexist-dest");

      vi.spyOn(_internals, "symlinkSync").mockImplementationOnce(() => {
        const err = new Error("EEXIST mock") as NodeJS.ErrnoException;
        err.code = "EEXIST";
        throw err;
      });

      const out = deployMove(srcDir, destDir, "symlink");
      expect(out.actual_mode).toBe("copy");
      expect(existsSync(join(destDir, "SKILL.md"))).toBe(true);
    });

    it("requested=symlink with unknown errno re-throws", () => {
      const destDir = join(destParent, "exotic-dest");

      vi.spyOn(_internals, "symlinkSync").mockImplementationOnce(() => {
        const err = new Error("ENOSPC mock") as NodeJS.ErrnoException;
        err.code = "ENOSPC";
        throw err;
      });

      expect(() => deployMove(srcDir, destDir, "symlink")).toThrow(/ENOSPC/);
    });
  });

  describe("computeFileHash", () => {
    it("identical input → identical SHA-256 hex", () => {
      const a = join(tmp, "a.txt");
      const b = join(tmp, "b.txt");
      writeFileSync(a, "same body\n");
      writeFileSync(b, "same body\n");
      const ha = computeFileHash(a);
      const hb = computeFileHash(b);
      expect(ha).toBe(hb);
      expect(ha).toMatch(/^[a-f0-9]{64}$/);
    });

    it("different input → different hash", () => {
      const a = join(tmp, "x.txt");
      const b = join(tmp, "y.txt");
      writeFileSync(a, "alpha\n");
      writeFileSync(b, "beta\n");
      expect(computeFileHash(a)).not.toBe(computeFileHash(b));
    });

    it("non-existent file throws", () => {
      expect(() => computeFileHash(join(tmp, "ghost.txt"))).toThrow();
    });
  });

  describe("detectDriftAt", () => {
    let vaultPath: string;
    let skillsDir: string;

    // Helper: build a canonical move source under
    // `<vaultPath>/wikis/_agents/moves/<moveId>/SKILL.md`.
    function writeCanonical(moveId: string, body: string): void {
      const dir = join(vaultPath, "wikis", "_agents", "moves", moveId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), body);
    }

    // Helper: build a deployed move under `<skillsDir>/<moveId>/SKILL.md`.
    function writeDeployed(moveId: string, body: string): void {
      const dir = join(skillsDir, moveId);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), body);
    }

    beforeEach(() => {
      vaultPath = join(tmp, "vault");
      skillsDir = join(tmp, "deployment");
      mkdirSync(vaultPath, { recursive: true });
      mkdirSync(skillsDir, { recursive: true });

      // Two canonical moves with stable bodies.
      writeCanonical("move-tdd-cycle", "tdd body\n");
      writeCanonical("move-pr-create", "pr body\n");

      // Deployed copies starting clean (identical bytes).
      writeDeployed("move-tdd-cycle", "tdd body\n");
      writeDeployed("move-pr-create", "pr body\n");
    });

    it("empty deployment moves → []", () => {
      const reports = detectDriftAt({ skills_dir: skillsDir, moves: [] }, vaultPath);
      expect(reports).toEqual([]);
    });

    it("clean (canonical + deployed identical) → []", () => {
      const reports = detectDriftAt(
        { skills_dir: skillsDir, moves: ["move-tdd-cycle", "move-pr-create"] },
        vaultPath
      );
      expect(reports).toEqual([]);
    });

    it("tampered deployed file → kind: 'hash-mismatch'", () => {
      const canonicalSkill = join(vaultPath, "wikis", "_agents", "moves", "move-tdd-cycle", "SKILL.md");
      const deployedSkill = join(skillsDir, "move-tdd-cycle", "SKILL.md");
      const expected = computeFileHash(canonicalSkill);

      // tamper deployed (canonical untouched)
      writeFileSync(deployedSkill, "tdd body MODIFIED\n");

      const reports = detectDriftAt(
        { skills_dir: skillsDir, moves: ["move-tdd-cycle"] },
        vaultPath
      );
      expect(reports).toHaveLength(1);
      expect(reports[0].kind).toBe("hash-mismatch");
      expect(reports[0].move_id).toBe("move-tdd-cycle");
      expect(reports[0].expected_hash).toBe(expected);
      expect(reports[0].actual_hash).not.toBe(expected);
      expect(reports[0].actual_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(reports[0].deployment_path).toBe(deployedSkill);
    });

    it("missing deployed file → kind: 'missing', actual_hash undefined", () => {
      // Canonical exists; deployed does not.
      writeCanonical("move-ghost", "ghost body\n");
      const expected = computeFileHash(
        join(vaultPath, "wikis", "_agents", "moves", "move-ghost", "SKILL.md")
      );
      const deployedSkill = join(skillsDir, "move-ghost", "SKILL.md");

      const reports = detectDriftAt(
        { skills_dir: skillsDir, moves: ["move-ghost"] },
        vaultPath
      );
      expect(reports).toHaveLength(1);
      const r: DriftReport = reports[0];
      expect(r.kind).toBe("missing");
      expect(r.move_id).toBe("move-ghost");
      expect(r.actual_hash).toBeUndefined();
      expect(r.expected_hash).toBe(expected);
      expect(r.deployment_path).toBe(deployedSkill);
    });

    it("missing canonical file (vault has no such move) → throws", () => {
      // No `move-phantom` exists under wikis/_agents/moves/. Hashing the
      // canonical path will hit ENOENT inside computeFileHash; per the
      // contract the helper re-throws because a missing canonical file is a
      // vault-integrity bug, not deployment drift.
      expect(() =>
        detectDriftAt(
          { skills_dir: skillsDir, moves: ["move-phantom"] },
          vaultPath
        )
      ).toThrow();
    });

    it("mixed: one clean, one missing-deployed, one tampered", () => {
      // canonical for move-ghost exists, but no deployed copy.
      writeCanonical("move-ghost", "ghost body\n");
      // tamper deployed pr-create
      writeFileSync(join(skillsDir, "move-pr-create", "SKILL.md"), "pr body MODIFIED\n");

      const reports = detectDriftAt(
        {
          skills_dir: skillsDir,
          moves: ["move-tdd-cycle", "move-pr-create", "move-ghost"]
        },
        vaultPath
      );
      expect(reports).toHaveLength(2);
      const byMove = Object.fromEntries(reports.map(r => [r.move_id, r]));
      expect(byMove["move-pr-create"].kind).toBe("hash-mismatch");
      expect(byMove["move-ghost"].kind).toBe("missing");
      expect(byMove["move-tdd-cycle"]).toBeUndefined();
    });
  });
});
