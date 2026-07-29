// src/core/follow-up-plan.ts
//
// Pure builder turning one ready stoa task into the two-item impl+verify
// plan.json that lane B submits. Kept free of filesystem access so the
// emitted shape is snapshot-testable without a vault.

import { canonicalizeLockPath } from "./lock-path.js";
import { parseFourSection } from "./four-section.js";

export interface FollowUpPlanInput {
  taskId: string;
  body: string;
  segregation: string[];
  date: string; // yyyy-mm-dd, injected so the builder stays pure
}

/** The subset of pangolin's WorkItem this builder emits. */
export interface PlanItem {
  id: string;
  executor: string;
  inputs: Record<string, unknown>;
  depends_on: string[];
  resourceLocks: string[];
  needs?: Record<string, { from: string; select: { kind: "patch" } }>;
}

/** The subset of pangolin's Run this builder emits. */
export interface FollowUpPlan {
  id: string;
  queue: "followups";
  items: PlanItem[];
}

/** Build the lane-B plan.json object. Throws if a segregation entry is a glob or absolute. */
export function buildFollowUpPlan(input: FollowUpPlanInput): FollowUpPlan {
  const locks = input.segregation.map(canonicalizeLockPath);
  const scope = parseFourSection(input.body, "Scope");
  const outOfScope = parseFourSection(input.body, "Out of scope");
  const verification = parseFourSection(input.body, "Verification");

  return {
    id: `followup-${input.taskId}-${input.date}`,
    queue: "followups",
    items: [
      {
        id: "impl",
        executor: "dispatch",
        inputs: {
          subagent: "follow-up-implementer",
          workerInput: { instructions: `${scope}\n\nOut of scope:\n${outOfScope}` },
        },
        depends_on: [],
        resourceLocks: locks,
      },
      {
        id: "verify",
        executor: "dispatch",
        inputs: {
          subagent: "follow-up-verifier",
          workerInput: { instructions: verification },
          gate: {
            onRed: "spawn-fix",
            subject: "impl",
            maxFixAttempts: 1,
            fixTemplate: {
              executor: "dispatch",
              inputs: { subagent: "follow-up-fixer", workerInput: { instructions: verification } },
              resourceLocks: locks,
            },
          },
        },
        depends_on: [],
        resourceLocks: [],
        needs: { work: { from: "impl", select: { kind: "patch" } } },
      },
    ],
  };
}
