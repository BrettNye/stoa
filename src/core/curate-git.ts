import { execFileSync } from "node:child_process";

export type PrMergeState = "merged" | "open" | "unknown";
export type Runner = (cmd: string, args: string[]) => { code: number; stdout: string };

/**
 * Verify whether a PR reference is merged, open, or in an unknown state.
 *
 * @param ref - A PR reference string, e.g. "github.com/owner/name/pull/14"
 * @param run - Injectable shell runner; defaults to execFileSync-based runner
 * @returns "merged" | "open" | "unknown"
 *
 * "unknown" is returned when:
 *   - ref has no /pull/<n> segment
 *   - gh exits non-zero (no gh installed, network failure, etc.)
 *   - gh returns an unrecognised state string
 */
export function verifyPrMerged(ref: string, run: Runner): PrMergeState {
  const m = ref.match(/github\.com\/([\w./-]+\/[\w.-]+)\/pull\/(\d+)/);
  if (!m) return "unknown";
  const [, repo, prNum] = m;
  const res = run("gh", ["pr", "view", prNum, "--repo", repo, "--json", "state", "-q", ".state"]);
  if (res.code !== 0) return "unknown";
  const state = res.stdout.trim().toUpperCase();
  if (state === "MERGED") return "merged";
  if (state === "OPEN" || state === "CLOSED") return "open";
  return "unknown";
}

/**
 * Default production runner that shells out via execFileSync.
 * Returns code 1 + empty stdout on any exception (network failure, no gh, etc.).
 */
export function makeDefaultRunner(): Runner {
  return (cmd: string, args: string[]) => {
    try {
      const stdout = execFileSync(cmd, args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
      return { code: 0, stdout };
    } catch (err: unknown) {
      const e = err as { status?: number; stdout?: string };
      return { code: e.status ?? 1, stdout: e.stdout ?? "" };
    }
  };
}
