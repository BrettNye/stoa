import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module under test.
vi.mock("../../src/core/resolve-trainer-context.js", () => ({
  resolveTrainerContext: vi.fn(() => ({
    trainerSlug: "brett",
    trainerId: "trainer-brett-id",
    wiki: "_agents"
  }))
}));

vi.mock("../../src/core/stadium-config.js", () => ({
  resolveStadiumConfig: vi.fn(() => ({
    api_key: "test-key",
    base_url: "http://test.example"
  }))
}));

vi.mock("../../src/core/stadium-client.js", () => {
  const submitMove = vi.fn();
  class StadiumClient {
    constructor(_opts: unknown) {}
    submitMove = submitMove;
  }
  return { StadiumClient, _submitMoveMock: submitMove };
});

import { trainerSubmitTool } from "../../src/tools/trainer-submit.js";
import * as stadiumClientModule from "../../src/core/stadium-client.js";

describe("vault_trainer-submit { mode: 'move' } handler", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let submitMoveMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Access the shared mock function from the mocked module.
    submitMoveMock = (stadiumClientModule as unknown as { _submitMoveMock: ReturnType<typeof vi.fn> })._submitMoveMock;
    submitMoveMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns platform fields merged with caller_trainer_id on success", async () => {
    submitMoveMock.mockResolvedValue({
      match_id: "match-123",
      turn: 2,
      status: "waiting"
    });

    const result = await trainerSubmitTool.handler({
      mode: "move",
      match_id: "match-123",
      turn: 2,
      move_id: "move-tackle"
    });

    expect(result).toEqual({
      match_id: "match-123",
      turn: 2,
      status: "waiting",
      caller_trainer_id: "trainer-brett-id"
    });
  });

  it("throws when platform responds with undefined (e.g. 204 No Content)", async () => {
    submitMoveMock.mockResolvedValue(undefined);

    await expect(
      trainerSubmitTool.handler({
        mode: "move",
        match_id: "match-123",
        turn: 2,
        move_id: "move-tackle"
      })
    ).rejects.toThrow("submitMove: unexpected non-object response from platform");
  });

  it("throws when platform responds with null", async () => {
    submitMoveMock.mockResolvedValue(null);

    await expect(
      trainerSubmitTool.handler({
        mode: "move",
        match_id: "match-123",
        turn: 2,
        move_id: "move-tackle"
      })
    ).rejects.toThrow("submitMove: unexpected non-object response from platform");
  });

  it("throws when platform responds with a primitive (string)", async () => {
    submitMoveMock.mockResolvedValue("ok");

    await expect(
      trainerSubmitTool.handler({
        mode: "move",
        match_id: "match-123",
        turn: 2,
        move_id: "move-tackle"
      })
    ).rejects.toThrow("submitMove: unexpected non-object response from platform");
  });
});
