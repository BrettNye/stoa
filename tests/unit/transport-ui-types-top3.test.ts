import { it, expect, describe } from "vitest";
import type {
  ReleaseRequest,
  ReleaseResponse,
  ReleaseConflictResponse,
  ApiSynthesisStalenessInput,
  ApiSynthesisStaleness,
  ApiSynthesisStalenessResponse,
} from "../../src/transport/ui/types.js";

describe("ReleaseRequest", () => {
  it("accepts expected_updated and optional reason", () => {
    const req: ReleaseRequest = {
      expected_updated: "2026-05-12T10:00:00Z",
    };
    expect(req.expected_updated).toBeDefined();

    const reqWithReason: ReleaseRequest = {
      expected_updated: "2026-05-12T10:00:00Z",
      reason: "timed out",
    };
    expect(reqWithReason.reason).toBe("timed out");
  });
});

describe("ReleaseResponse", () => {
  it("has ok: true and a task field", () => {
    const resp: ReleaseResponse = {
      ok: true,
      task: {
        id: "task-foo",
        title: "Foo",
        wiki: "_agents",
        status: "pending",
        updated: "2026-05-12T10:00:00Z",
      },
    };
    expect(resp.ok).toBe(true);
    expect(resp.task.id).toBe("task-foo");
  });
});

describe("ReleaseConflictResponse", () => {
  it("has ok: false and error as OccMismatch or NotClaimed", () => {
    const occMismatch: ReleaseConflictResponse = {
      ok: false,
      error: "OccMismatch",
      current_updated: "2026-05-12T09:00:00Z",
      current_status: "claimed",
    };
    expect(occMismatch.ok).toBe(false);
    expect(occMismatch.error).toBe("OccMismatch");

    const notClaimed: ReleaseConflictResponse = {
      ok: false,
      error: "NotClaimed",
    };
    expect(notClaimed.error).toBe("NotClaimed");
  });

  it("error field is a string-literal union mirroring ClaimConflictResponse pattern", () => {
    // Verify both literal values compile as the error field
    const errors: Array<ReleaseConflictResponse["error"]> = [
      "OccMismatch",
      "NotClaimed",
    ];
    expect(errors).toHaveLength(2);
  });
});

describe("ApiSynthesisStalenessInput", () => {
  it("carries id and updated fields", () => {
    const input: ApiSynthesisStalenessInput = {
      id: "synthesis-foo",
      updated: "2026-05-01T00:00:00Z",
    };
    expect(input.id).toBe("synthesis-foo");
    expect(input.updated).toBeDefined();
  });
});

describe("ApiSynthesisStaleness", () => {
  it("has nullable last_compiled and lag_days for never-compiled case", () => {
    const neverCompiled: ApiSynthesisStaleness = {
      id: "synthesis-uncomplied",
      wiki: "crewtracks-modules",
      title: "Some Synthesis",
      last_compiled: null,
      lag_days: null,
      stale_inputs: [],
    };
    expect(neverCompiled.last_compiled).toBeNull();
    expect(neverCompiled.lag_days).toBeNull();
  });

  it("has non-null last_compiled and lag_days for compiled case", () => {
    const compiled: ApiSynthesisStaleness = {
      id: "synthesis-compiled",
      wiki: "crewtracks-modules",
      title: "Another Synthesis",
      last_compiled: "2026-04-01T00:00:00Z",
      lag_days: 41,
      stale_inputs: [
        { id: "concept-foo", updated: "2026-04-15T00:00:00Z" },
      ],
    };
    expect(compiled.lag_days).toBe(41);
    expect(compiled.stale_inputs).toHaveLength(1);
  });
});

describe("ApiSynthesisStalenessResponse", () => {
  it("has syntheses array and generatedAt string", () => {
    const resp: ApiSynthesisStalenessResponse = {
      syntheses: [],
      generatedAt: "2026-05-12T10:00:00Z",
    };
    expect(resp.syntheses).toBeInstanceOf(Array);
    expect(resp.generatedAt).toBeDefined();
  });
});
