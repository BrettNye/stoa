import { describe, it, expect } from "vitest";
import { buildFollowUpPlan } from "./follow-up-plan.js";

const body = "# T\n\n## Scope\ndo the thing\n\n## Out of scope\nnot that\n\n## Verification\nnpm test passes\n";

describe("buildFollowUpPlan", () => {
  const gateOf = (p: ReturnType<typeof buildFollowUpPlan>) =>
    p.items[1].inputs.gate as { maxFixAttempts: number; fixTemplate: { resourceLocks: string[] } };

  it("binds the verify item to impl's patch under the key `work`", () => {
    const plan = buildFollowUpPlan({ taskId: "task-x", body, segregation: ["./src/a.ts"], date: "2026-07-29" });
    expect(plan.items[1].needs?.work).toEqual({ from: "impl", select: { kind: "patch" } });
    expect(gateOf(plan).maxFixAttempts).toBe(1);
  });

  it("canonicalizes locks and gives impl and the fix template the same strings", () => {
    const plan = buildFollowUpPlan({ taskId: "task-x", body, segregation: ["./src/a.ts"], date: "2026-07-29" });
    expect(plan.items[0].resourceLocks).toEqual(["src/a.ts"]);
    expect(gateOf(plan).fixTemplate.resourceLocks).toEqual(plan.items[0].resourceLocks);
  });

  it("emits queue and exactly two items, impl then verify", () => {
    const plan = buildFollowUpPlan({ taskId: "task-x", body, segregation: [], date: "2026-07-29" });
    expect(plan.queue).toBe("followups");
    expect(plan.items.map((i) => i.id)).toEqual(["impl", "verify"]);
  });

  it("gives every item a non-empty subagent, matching implementer/verifier/fixer roles", () => {
    const plan = buildFollowUpPlan({ taskId: "task-x", body, segregation: [], date: "2026-07-29" });
    const gate = plan.items[1].inputs.gate as { fixTemplate: { inputs: { subagent: string } } };
    expect(plan.items[0].inputs.subagent).toBe("follow-up-implementer");
    expect(plan.items[1].inputs.subagent).toBe("follow-up-verifier");
    expect(gate.fixTemplate.inputs.subagent).toBe("follow-up-fixer");
  });

  it("sets the verify item's gate to spawn-fix on impl, bounded to one attempt", () => {
    const plan = buildFollowUpPlan({ taskId: "task-x", body, segregation: [], date: "2026-07-29" });
    const gate = plan.items[1].inputs.gate as { onRed: string; subject: string; maxFixAttempts: number };
    expect(gate.onRed).toBe("spawn-fix");
    expect(gate.subject).toBe("impl");
    expect(gate.maxFixAttempts).toBe(1);
  });

  it("propagates the glob throw from canonicalizeLockPath instead of emitting an inert lock", () => {
    expect(() =>
      buildFollowUpPlan({ taskId: "task-x", body, segregation: ["src/*.ts"], date: "2026-07-29" })
    ).toThrow(/glob/);
  });

  it("derives the plan id from taskId and the injected date, with no clock access", () => {
    const plan = buildFollowUpPlan({ taskId: "task-x", body, segregation: [], date: "2026-07-29" });
    expect(plan.id).toBe("followup-task-x-2026-07-29");
  });
});
