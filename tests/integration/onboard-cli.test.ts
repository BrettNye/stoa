import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";

// --- module-level mutable state used by vi.mock closures ---
// These are reassigned per-test before the action runs.
let mockHomedir: string = tmpdir();

beforeEach(() => {
  mockHomedir = mkdtempSync(join(tmpdir(), "onboard-test-home-"));
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => mockHomedir,
  };
});

vi.mock("../../src/core/onboard-interview.js", () => ({
  runInterview: vi.fn(async () => ({
    team_or_solo: "solo",
    vault_path_chosen: undefined,
    work_surfaces: ["code"],
    role: "engineering",
    interaction_mode: "passive",
    wish_remembered: "remember my preferences",
    per_wiki_descriptions: { codebase: "daily coding work" },
  })),
}));

// Import the mocked module so we can call vi.mocked on it
import { runInterview } from "../../src/core/onboard-interview.js";
import { registerOnboard } from "../../src/cli/commands/onboard.js";
import { PRIMER_MARKER_START } from "../../src/core/ai-primer-template.js";

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

async function withCapturedStdout<T>(fn: () => Promise<T>): Promise<{ output: string; result: T }> {
  const lines: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string) => {
    lines.push(chunk);
    return true;
  }) as typeof process.stdout.write;
  try {
    const result = await fn();
    return { output: lines.join(""), result };
  } finally {
    process.stdout.write = orig;
  }
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerOnboard(program);
  return program;
}

// -----------------------------------------------------------------------
// Existing basic registration tests (kept)
// -----------------------------------------------------------------------

it("registers the onboard subcommand on the program", () => {
  const program = new Command();
  registerOnboard(program);
  const found = program.commands.find((c) => c.name() === "onboard");
  expect(found).toBeDefined();
});

it("onboard subcommand has --diagnose option", () => {
  const program = new Command();
  registerOnboard(program);
  const found = program.commands.find((c) => c.name() === "onboard")!;
  const diagnoseOpt = found.options.find((o) => o.long === "--diagnose");
  expect(diagnoseOpt).toBeDefined();
});

// -----------------------------------------------------------------------
// --diagnose flag
// -----------------------------------------------------------------------

describe("--diagnose flag prints check results", () => {
  it("prints ✓/✗ lines for each check", async () => {
    const { output } = await withCapturedStdout(async () => {
      const program = makeProgram();
      await program.parseAsync(["onboard", "--diagnose"], { from: "user" });
    });
    expect(output).toMatch(/[✓✗]/);
    expect(output.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------
// Issue 1 — No-CC-install path exits with code 1
// -----------------------------------------------------------------------

describe("no Claude Code install detected", () => {
  it("exits with code 1 and prints 'No Claude Code install detected' message", async () => {
    // Temp home with NO .claude/ directory — detectClients will find nothing
    const home = mkdtempSync(join(tmpdir(), "onboard-noccinstall-"));
    mockHomedir = home;

    const savedExitCode = process.exitCode;
    process.exitCode = undefined;

    const { output } = await withCapturedStdout(async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "stoa", "onboard"]);
    });

    const exitCode = process.exitCode;
    process.exitCode = savedExitCode as any;

    expect(exitCode).toBe(1);
    expect(output).toContain("No Claude Code install detected");
  });
});

// -----------------------------------------------------------------------
// Issue 2 — Team mode: no vault seeding, no wiki CLAUDE.md
// -----------------------------------------------------------------------

describe("team mode: no vault seeding", () => {
  it("writes onboarding.json but does NOT create wikis/ dir or wiki CLAUDE.md files", async () => {
    const home = mkdtempSync(join(tmpdir(), "onboard-team-home-"));
    const vaultPath = mkdtempSync(join(tmpdir(), "onboard-team-vault-"));
    mockHomedir = home;

    // Create .claude/ so the no-install guard doesn't fire
    mkdirSync(join(home, ".claude"), { recursive: true });

    vi.mocked(runInterview).mockResolvedValueOnce({
      team_or_solo: "team",
      vault_path_chosen: vaultPath,
      role: "engineering",
      interaction_mode: "passive",
      work_surfaces: [],
      wish_remembered: "",
      per_wiki_descriptions: {},
    });

    await withCapturedStdout(async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "stoa", "onboard"]);
    });

    // onboarding.json MUST exist
    expect(existsSync(join(vaultPath, "_index", "onboarding.json"))).toBe(true);

    // wikis/ subdirectory must NOT exist (no seeding)
    expect(existsSync(join(vaultPath, "wikis"))).toBe(false);

    // No wiki CLAUDE.md files
    const wikisPath = join(vaultPath, "wikis");
    expect(existsSync(wikisPath)).toBe(false);
  });
});

// -----------------------------------------------------------------------
// Issue 3 — Solo end-to-end via registered command (not helpers directly)
// -----------------------------------------------------------------------

describe("solo onboarding flow via registerOnboard wiring", () => {
  it("writes settings.json, CLAUDE.md with primer, onboarding.json, wiki subfolders, and inbox items", async () => {
    const home = mkdtempSync(join(tmpdir(), "onboard-solo-home-"));
    const vaultPath = mkdtempSync(join(tmpdir(), "onboard-solo-vault-"));
    mockHomedir = home;

    // Create .claude/ so the no-install guard doesn't fire
    const claudeDir = join(home, ".claude");
    mkdirSync(claudeDir, { recursive: true });

    vi.mocked(runInterview).mockResolvedValueOnce({
      team_or_solo: "solo",
      vault_path_chosen: vaultPath,
      role: "engineering",
      interaction_mode: "passive",
      work_surfaces: ["code"],
      wish_remembered: "remember my preferences",
      per_wiki_descriptions: { codebase: "daily coding work" },
    });

    await withCapturedStdout(async () => {
      const program = makeProgram();
      await program.parseAsync(["node", "stoa", "onboard"]);
    });

    // 1. settings.json contains mcpServers.stoa with correct vault path
    const settingsPath = join(claudeDir, "settings.json");
    expect(existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.mcpServers?.stoa).toBeDefined();
    expect(settings.mcpServers.stoa.env.STOA_VAULT_PATH).toBe(vaultPath);

    // 2. ~/.claude/CLAUDE.md contains PRIMER_MARKER_START
    const userMdPath = join(claudeDir, "CLAUDE.md");
    expect(existsSync(userMdPath)).toBe(true);
    const claudeMd = readFileSync(userMdPath, "utf8");
    expect(claudeMd).toContain(PRIMER_MARKER_START);

    // 3. _index/onboarding.json exists
    expect(existsSync(join(vaultPath, "_index", "onboarding.json"))).toBe(true);

    // 4. Selected wiki (codebase) has subfolders
    expect(existsSync(join(vaultPath, "wikis", "codebase", "inbox"))).toBe(true);
    expect(existsSync(join(vaultPath, "wikis", "codebase", "map.md"))).toBe(true);

    // 5. Wiki CLAUDE.md was written
    expect(existsSync(join(vaultPath, "wikis", "codebase", "CLAUDE.md"))).toBe(true);

    // 6. Inbox item written (wish_remembered)
    const inboxDir = join(vaultPath, "wikis", "codebase", "inbox");
    const inboxFiles = (await import("node:fs")).readdirSync(inboxDir);
    expect(inboxFiles.length).toBeGreaterThan(0);
  });
});
