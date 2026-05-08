import type { SourceMatcher } from "../types.js";
import { journalMatcher } from "./journal.js";
import { taskMatcher } from "./task.js";

export const matchers: SourceMatcher<unknown>[] = [
  journalMatcher as SourceMatcher<unknown>,
  taskMatcher as SourceMatcher<unknown>,
];

export function getAllGlobs(): string[] {
  return matchers.flatMap((m) => m.globs);
}

export { journalMatcher, taskMatcher };
