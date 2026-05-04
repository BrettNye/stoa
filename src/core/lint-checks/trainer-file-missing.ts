import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { registerLintCheck } from "../lint-check.js";
import type { Diagnostic } from "../lint.js";

// TRAINER_FILE_MISSING (severity:error). Stadium substrate spec §3.3.
//
// When linting `_agents/`, reads `~/.vault/stadium.toml` (respects STADIUM_HOME)
// to enumerate `[trainer.<slug>]` blocks. For each slug, verifies that
// `wikis/_agents/trainers/trainer-<slug>.md` exists in the vault. If absent,
// emits an error-severity diagnostic.
//
// Absence of stadium.toml → no diagnostics. Only fires when wiki filter is
// `_agents` or absent (all-wikis scan). Does NOT fire for other wikis.
//
// Companion rules: TRAINER_TOML_MISSING (inverse), TRAINER_ID_MISMATCH (drift).
registerLintCheck({
  code: "TRAINER_FILE_MISSING",
  run(ctx, _idx, input): Diagnostic[] {
    // Only fire for _agents wiki
    if (input.wiki && input.wiki !== "_agents") return [];

    const tomlTrainers = readStadiumTomlTrainers();
    if (tomlTrainers.size === 0) return [];

    const trainersDir = join(ctx.vaultPath, "wikis", "_agents", "trainers");
    const diagnostics: Diagnostic[] = [];

    for (const slug of tomlTrainers.keys()) {
      const filePath = join(trainersDir, `trainer-${slug}.md`);
      if (!existsSync(filePath)) {
        diagnostics.push({
          severity: "error",
          code: "TRAINER_FILE_MISSING",
          wiki: "_agents",
          message: `toml [trainer.${slug}] has no matching wikis/_agents/trainers/trainer-${slug}.md`,
          suggestion: `create wikis/_agents/trainers/trainer-${slug}.md with trainer_id, trainer_slug, wiki fields`,
        });
      }
    }

    return diagnostics;
  },
});

/**
 * Read all [trainer.<slug>] sections from ~/.vault/stadium.toml.
 * Returns a Map of slug → { trainer_id }. Missing toml → empty map.
 * Respects STADIUM_HOME env var for test isolation.
 */
export function readStadiumTomlTrainers(): Map<string, { trainer_id: string | undefined }> {
  const home = process.env.STADIUM_HOME ?? homedir();
  const tomlPath = join(home, ".vault", "stadium.toml");
  if (!existsSync(tomlPath)) return new Map();

  let content: string;
  try {
    content = readFileSync(tomlPath, "utf8");
  } catch {
    return new Map();
  }

  return parseTrainersFromToml(content);
}

/**
 * Read all trainer-<slug>.md files from wikis/_agents/trainers/.
 * Returns a Map of slug → { trainer_id, filePath }. Missing dir → empty map.
 */
export function readAgentTrainerFiles(vaultPath: string): Map<string, { trainer_id: string | undefined; filePath: string }> {
  const trainersDir = join(vaultPath, "wikis", "_agents", "trainers");
  if (!existsSync(trainersDir)) return new Map();

  const result = new Map<string, { trainer_id: string | undefined; filePath: string }>();

  let entries: string[];
  try {
    entries = readdirSync(trainersDir);
  } catch {
    return result;
  }

  for (const file of entries) {
    if (!file.endsWith(".md")) continue;
    // Only files matching trainer-<slug>.md pattern
    if (!file.startsWith("trainer-")) continue;
    const slug = file.slice("trainer-".length, -".md".length);
    if (!slug) continue;

    const filePath = join(trainersDir, file);
    let trainer_id: string | undefined;
    try {
      const raw = readFileSync(filePath, "utf8");
      trainer_id = extractTrainerId(raw);
    } catch {
      // skip malformed files
    }
    result.set(slug, { trainer_id, filePath });
  }

  return result;
}

function parseTrainersFromToml(content: string): Map<string, { trainer_id: string | undefined }> {
  const result = new Map<string, { trainer_id: string | undefined }>();
  let currentTrainerSlug: string | null = null;
  let currentTrainerId: string | undefined;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Strip trailing inline comment from section header candidates
    // e.g. "[trainer.brett] # comment" → "[trainer.brett]"
    const headerLine = line.includes(" #") ? line.slice(0, line.indexOf(" #")).trimEnd() : line;
    if (headerLine.startsWith("[") && headerLine.endsWith("]")) {
      // Flush previous section
      if (currentTrainerSlug !== null) {
        result.set(currentTrainerSlug, { trainer_id: currentTrainerId });
      }
      const section = headerLine.slice(1, -1).trim();
      if (section.startsWith("trainer.")) {
        const slug = section.slice("trainer.".length);
        if (slug) {
          currentTrainerSlug = slug;
          currentTrainerId = undefined;
        } else {
          currentTrainerSlug = null;
          currentTrainerId = undefined;
        }
      } else {
        currentTrainerSlug = null;
        currentTrainerId = undefined;
      }
      continue;
    }

    if (currentTrainerSlug !== null) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      if (key === "trainer_id") {
        let value = line.slice(eq + 1).trim();
        if (value.startsWith('"') || value.startsWith("'")) {
          const q = value[0];
          const close = value.indexOf(q, 1);
          value = close > 0 ? value.slice(1, close) : value.slice(1);
        }
        currentTrainerId = value;
      }
    }
  }

  // Flush last section
  if (currentTrainerSlug !== null) {
    result.set(currentTrainerSlug, { trainer_id: currentTrainerId });
  }

  return result;
}

function extractTrainerId(raw: string): string | undefined {
  // Extract trainer_id from YAML frontmatter without a full YAML parser.
  // Frontmatter is between the first `---\n` and the second `---\n`.
  const start = raw.startsWith("---") ? raw.indexOf("\n") + 1 : -1;
  if (start < 0) return undefined;
  const end = raw.indexOf("\n---", start);
  const fm = end >= 0 ? raw.slice(start, end) : raw.slice(start);

  for (const line of fm.split("\n")) {
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim();
    if (key === "trainer_id") {
      return line.slice(colon + 1).trim();
    }
  }
  return undefined;
}
