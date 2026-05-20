import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { type SyncFolder } from "./sync-folder-detection.js";

export type InterviewAnswers = {
  team_or_solo: "team" | "solo";
  vault_path_chosen?: string;
  /** Raw surface keys (e.g. "code"), not wiki names. Use WIKI_FROM_SURFACE to map to wiki names (e.g. "codebase") as stored in per_wiki_descriptions. */
  work_surfaces: string[];
  role: "engineering" | "sales" | "marketing" | "leadership" | "other";
  interaction_mode: "passive" | "active";
  wish_remembered: string;
  per_wiki_descriptions: Record<string, string>;
};

const WIKI_FROM_SURFACE: Record<string, string> = {
  meetings: "meetings",
  code: "codebase",
  research: "research",
  planning: "planning",
  content: "content",
};

const ROLE_MAP: Record<string, InterviewAnswers["role"]> = {
  e: "engineering",
  s: "sales",
  m: "marketing",
  l: "leadership",
  o: "other",
};

export type InterviewOpts = {
  syncFolders: SyncFolder[];
  /** Optional dependency-injected ask function. When omitted, uses readline over stdin/stdout. */
  ask?: (question: string) => Promise<string>;
};

export async function runInterview(opts: InterviewOpts): Promise<InterviewAnswers> {
  let rl: ReturnType<typeof createInterface> | undefined;
  let ask: (q: string) => Promise<string>;

  if (opts.ask) {
    ask = opts.ask;
  } else {
    rl = createInterface({ input: stdin, output: stdout });
    ask = (q: string) => rl!.question(q);
  }

  try {
    const q1 = (await ask("Q1. Joining existing vault [j] or starting fresh [s]? ")).trim().toLowerCase();
    const team = q1.startsWith("j"); // "j" = join existing vault → team flow

    let vault_path_chosen: string | undefined;
    if (team) {
      vault_path_chosen = (await ask("Path to existing vault folder: ")).trim();
    }

    // Q-numbers are out of sequence in the source on purpose: Q3 (role) and Q4 (mode)
    // are asked for ALL users; Q2/Q5/Q5b are gated behind the solo branch below.
    const roleAnswer = (await ask(
      "Q3. Role — engineering [e] sales [s] marketing [m] leadership [l] other [o]? "
    )).trim().toLowerCase();

    const modeAnswer = (await ask(
      "Q4. Filing — passive [p] (AI just handles it) or active [a] (AI asks first)? "
    )).trim().toLowerCase();

    let work_surfaces: string[] = [];
    let wish_remembered = "";
    let per_wiki_descriptions: Record<string, string> = {};

    if (!team) {
      const surfaces = (await ask(
        "Q2. Work surfaces — comma-separated from {meetings, code, research, planning, content}: "
      )).trim();
      work_surfaces = surfaces
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s in WIKI_FROM_SURFACE);

      wish_remembered = (await ask(
        "Q5. What do you wish your AI remembered between sessions? "
      )).trim();

      const wikiNames = Array.from(
        new Set(work_surfaces.map((s) => WIKI_FROM_SURFACE[s]))
      ).slice(0, 3);

      for (const w of wikiNames) {
        per_wiki_descriptions[w] = (await ask(
          `Q5b (${w}). In one sentence, what would you use this wiki for? `
        )).trim();
      }
    }

    return {
      team_or_solo: team ? "team" : "solo",
      vault_path_chosen,
      work_surfaces,
      role: ROLE_MAP[roleAnswer] ?? "other",
      interaction_mode: modeAnswer.startsWith("a") ? "active" : "passive",
      wish_remembered,
      per_wiki_descriptions,
    };
  } finally {
    if (rl) rl.close();
  }
}
