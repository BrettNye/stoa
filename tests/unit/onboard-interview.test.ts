import { describe, it, expect } from "vitest";
import { runInterview, type InterviewAnswers } from "../../src/core/onboard-interview.js";

// Helper: build a mock `ask` function from a queue of answers
function mockAsk(answers: string[]): (q: string) => Promise<string> {
  let i = 0;
  return async (_q: string) => {
    if (i >= answers.length) throw new Error(`Unexpected question at index ${i}`);
    return answers[i++];
  };
}

describe("runInterview", () => {
  describe("solo flow (Q1 = 's')", () => {
    it("returns team_or_solo: solo", async () => {
      // Q1, Q3, Q4, Q2, Q5, Q5b(meetings)
      const ask = mockAsk(["s", "e", "p", "meetings", "context between sessions", "Log meeting notes"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.team_or_solo).toBe("solo");
    });

    it("vault_path_chosen is undefined in solo mode", async () => {
      const ask = mockAsk(["s", "e", "p", "meetings", "memory", "Meeting notes"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.vault_path_chosen).toBeUndefined();
    });

    it("parses role correctly", async () => {
      const ask = mockAsk(["s", "e", "p", "meetings", "x", "y"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.role).toBe("engineering");
    });

    it("role falls back to other for unrecognized letter", async () => {
      const ask = mockAsk(["s", "z", "p", "meetings", "x", "y"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.role).toBe("other");
    });

    it("interaction_mode is passive when Q4 does not start with a", async () => {
      const ask = mockAsk(["s", "e", "p", "meetings", "x", "y"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.interaction_mode).toBe("passive");
    });

    it("interaction_mode is active when Q4 starts with a", async () => {
      const ask = mockAsk(["s", "e", "active", "meetings", "x", "y"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.interaction_mode).toBe("active");
    });

    it("parses work_surfaces from Q2", async () => {
      const ask = mockAsk(["s", "e", "p", "meetings, code", "memory", "meetings desc", "codebase desc"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.work_surfaces).toEqual(["meetings", "code"]);
    });

    it("filters unknown surfaces from Q2", async () => {
      const ask = mockAsk(["s", "e", "p", "meetings, unknown, code", "memory", "meetings desc", "codebase desc"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.work_surfaces).toEqual(["meetings", "code"]);
    });

    it("populates wish_remembered from Q5", async () => {
      const ask = mockAsk(["s", "e", "p", "meetings", "remember my deadlines", "notes wiki desc"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.wish_remembered).toBe("remember my deadlines");
    });

    it("caps per_wiki_descriptions to 3 wikis even if more surfaces selected", async () => {
      // meetings->meetings, code->codebase, research->research, planning->planning, content->content
      // 5 surfaces = 5 wikis, but should cap at 3
      const ask = mockAsk([
        "s", "e", "p",
        "meetings, code, research, planning, content",
        "many things",
        "wiki1 desc",
        "wiki2 desc",
        "wiki3 desc",
      ]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(Object.keys(answers.per_wiki_descriptions)).toHaveLength(3);
    });

    it("per_wiki_descriptions keys match wiki names from surfaces", async () => {
      const ask = mockAsk(["s", "e", "p", "meetings, code", "memory", "meetings desc", "codebase desc"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.per_wiki_descriptions).toHaveProperty("meetings", "meetings desc");
      expect(answers.per_wiki_descriptions).toHaveProperty("codebase", "codebase desc");
    });
  });

  describe("team flow (Q1 = 'j')", () => {
    it("returns team_or_solo: team", async () => {
      // Q1 (j), vault path, Q3, Q4 — no Q2/Q5/Q5b
      const ask = mockAsk(["j", "/path/to/vault", "l", "p"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.team_or_solo).toBe("team");
    });

    it("captures vault_path_chosen from user input", async () => {
      const ask = mockAsk(["j", "/path/to/vault", "l", "p"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.vault_path_chosen).toBe("/path/to/vault");
    });

    it("skips Q2 so work_surfaces is empty", async () => {
      const ask = mockAsk(["j", "/vault", "e", "a"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.work_surfaces).toEqual([]);
    });

    it("skips Q5 so wish_remembered is empty string", async () => {
      const ask = mockAsk(["j", "/vault", "e", "a"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.wish_remembered).toBe("");
    });

    it("skips Q5b so per_wiki_descriptions is empty object", async () => {
      const ask = mockAsk(["j", "/vault", "e", "a"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.per_wiki_descriptions).toEqual({});
    });

    it("does NOT consume extra questions (mock queue is exactly exhausted)", async () => {
      // If team flow accidentally reads Q2/Q5/Q5b, it would throw "Unexpected question"
      const ask = mockAsk(["j", "/vault", "s", "p"]);
      await expect(runInterview({ syncFolders: [], ask })).resolves.not.toThrow();
    });
  });

  describe("edge cases", () => {
    it("trims whitespace from all answers", async () => {
      const ask = mockAsk(["  s  ", "  e  ", "  p  ", "  meetings  ", "  wish  ", "  desc  "]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.team_or_solo).toBe("solo");
      expect(answers.role).toBe("engineering");
      expect(answers.work_surfaces).toEqual(["meetings"]);
    });

    it("deduplicates wikis when multiple surfaces map to same wiki", async () => {
      // In current WIKI_FROM_SURFACE all are unique, but testing dedup logic
      // by using the same surface twice
      const ask = mockAsk(["s", "e", "p", "meetings, meetings", "memory", "desc1"]);
      const answers = await runInterview({ syncFolders: [], ask });
      // meetings,meetings deduplicates to one wiki
      expect(Object.keys(answers.per_wiki_descriptions)).toHaveLength(1);
    });

    it("handles empty surfaces gracefully with no Q5b prompts", async () => {
      const ask = mockAsk(["s", "e", "p", "", "wish"]);
      const answers = await runInterview({ syncFolders: [], ask });
      expect(answers.work_surfaces).toEqual([]);
      expect(answers.per_wiki_descriptions).toEqual({});
    });
  });
});
