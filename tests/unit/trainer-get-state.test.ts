import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before importing the module under test.
vi.mock("../../src/core/resolve-trainer-context.js", () => ({
  resolveTrainerContext: vi.fn(() => ({
    trainerSlug: "brett",
    trainerId: "01HTRAINER1BRETT00000000AA",
    wiki: "_agents",
  })),
}));

vi.mock("../../src/core/stadium-config.js", () => ({
  resolveStadiumConfig: vi.fn(() => ({
    api_key: "test-key",
    base_url: "http://test.example",
  })),
}));

vi.mock("../../src/core/stadium-client.js", () => {
  const getMatchState = vi.fn();
  class StadiumClient {
    constructor(_opts: unknown) {}
    getMatchState = getMatchState;
  }
  return { StadiumClient, _getMatchStateMock: getMatchState };
});

vi.mock("../../src/tools/stadium-list.js", () => ({
  listPlatformProfiles: vi.fn(),
  stadiumListTool: { name: "vault_stadium-list", handler: vi.fn(), inputSchema: {}, scope: {} },
}));

import { trainerGetStateTool } from "../../src/tools/trainer-get-state.js";
import * as stadiumClientModule from "../../src/core/stadium-client.js";
import * as listPlatformProfilesModule from "../../src/tools/stadium-list.js";

describe("vault_trainer-get-state handler — new fields", () => {
  let getMatchStateMock: ReturnType<typeof vi.fn>;
  let listProfilesMock: ReturnType<typeof vi.fn>;

  const TRAINER_A_ID = "01HTRAINER1BRETT00000000AA";
  const TRAINER_B_ID = "01HTRAINER2OTHER00000000BB";

  const baseBattleState = {
    match_id: "01HMATCH00000000000000001",
    status: "battle",
    turn: 3,
    events: [
      { turn: 2, actor: "a", kind: "move" },
      { turn: 2, actor: "b", kind: "move" },
    ],
    a: { trainerId: TRAINER_A_ID, activeIndex: 0, team: [] },
    b: { trainerId: TRAINER_B_ID, activeIndex: 0, team: [] },
  };

  const baseDraftingState = {
    match_id: "01HMATCH00000000000000002",
    status: "drafting",
    turn: 0,
    events: [],
    a: { trainerId: TRAINER_A_ID, activeIndex: 0, team: [] },
    b: { trainerId: TRAINER_B_ID, activeIndex: 0, team: [] },
  };

  beforeEach(() => {
    getMatchStateMock = (
      stadiumClientModule as unknown as {
        _getMatchStateMock: ReturnType<typeof vi.fn>;
      }
    )._getMatchStateMock;
    listProfilesMock = listPlatformProfilesModule.listPlatformProfiles as ReturnType<typeof vi.fn>;
    getMatchStateMock.mockReset();
    listProfilesMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── caller_trainer_id ────────────────────────────────────────────────────

  it("always includes caller_trainer_id from resolveTrainerContext", async () => {
    getMatchStateMock.mockResolvedValue({ ...baseBattleState });

    const result = await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" });

    expect(result.caller_trainer_id).toBe(TRAINER_A_ID);
  });

  // ─── caller_side ──────────────────────────────────────────────────────────

  it("sets caller_side to 'a' when trainerId matches side a", async () => {
    getMatchStateMock.mockResolvedValue({ ...baseBattleState });

    const result = await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" });

    expect(result.caller_side).toBe("a");
  });

  it("sets caller_side to 'b' when trainerId matches side b", async () => {
    // Swap: caller is trainer B
    const { resolveTrainerContext } = await import("../../src/core/resolve-trainer-context.js");
    vi.mocked(resolveTrainerContext).mockReturnValueOnce({
      trainerSlug: "other",
      trainerId: TRAINER_B_ID,
      wiki: "_agents",
    });
    getMatchStateMock.mockResolvedValue({ ...baseBattleState });

    const result = await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" });

    expect(result.caller_side).toBe("b");
  });

  it("throws when caller is not a participant in the match", async () => {
    const { resolveTrainerContext } = await import("../../src/core/resolve-trainer-context.js");
    vi.mocked(resolveTrainerContext).mockReturnValueOnce({
      trainerSlug: "outsider",
      trainerId: "01HTRAINER3OUTSIDER000000CC",
      wiki: "_agents",
    });
    getMatchStateMock.mockResolvedValue({ ...baseBattleState });

    await expect(
      trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" })
    ).rejects.toThrow("caller is not a participant in this match");
  });

  // ─── waiting_for_move ─────────────────────────────────────────────────────

  it("waiting_for_move is true when status=battle and no event for caller_side this turn", async () => {
    // turn 3, no events for turn 3 yet
    getMatchStateMock.mockResolvedValue({ ...baseBattleState });

    const result = await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" });

    expect(result.waiting_for_move).toBe(true);
  });

  it("waiting_for_move is false when caller already submitted a move this turn", async () => {
    // turn 3, side 'a' already submitted
    getMatchStateMock.mockResolvedValue({
      ...baseBattleState,
      events: [
        ...baseBattleState.events,
        { turn: 3, actor: "a", kind: "move" },
      ],
    });

    const result = await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" });

    expect(result.waiting_for_move).toBe(false);
  });

  it("waiting_for_move is false when status is not 'battle'", async () => {
    getMatchStateMock.mockResolvedValue({ ...baseDraftingState });
    listProfilesMock.mockResolvedValue({ profiles: [], caller_trainer_id: TRAINER_A_ID });

    const result = await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000002" });

    expect(result.waiting_for_move).toBe(false);
  });

  // ─── available_profiles ───────────────────────────────────────────────────

  it("includes available_profiles when status=drafting", async () => {
    const profiles = [
      {
        platform_profile_id: "01HPROFILE0000000000000001",
        pokemon: "charmeleon",
        owner_trainer_id: TRAINER_A_ID,
        real_skill_levels: { "skill-abc": 2 },
        profile_page_id: "profile-charmeleon",
        wiki: "_agents",
      },
    ];
    getMatchStateMock.mockResolvedValue({ ...baseDraftingState });
    listProfilesMock.mockResolvedValue({ profiles, caller_trainer_id: TRAINER_A_ID });

    const result = await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000002" });

    expect(result.available_profiles).toEqual(profiles);
  });

  it("available_profiles absent when status=battle", async () => {
    getMatchStateMock.mockResolvedValue({ ...baseBattleState });

    const result = await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" });

    expect(result.available_profiles).toBeUndefined();
  });

  it("listPlatformProfiles is called with owner_trainer_id when drafting", async () => {
    getMatchStateMock.mockResolvedValue({ ...baseDraftingState });
    listProfilesMock.mockResolvedValue({ profiles: [], caller_trainer_id: TRAINER_A_ID });

    await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000002" });

    expect(listProfilesMock).toHaveBeenCalledWith({ owner_trainer_id: TRAINER_A_ID });
  });

  // ─── existing fields unchanged ────────────────────────────────────────────

  it("preserves all existing fields from platform state", async () => {
    getMatchStateMock.mockResolvedValue({ ...baseBattleState });

    const result = await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" });

    expect(result.match_id).toBe(baseBattleState.match_id);
    expect(result.status).toBe(baseBattleState.status);
    expect(result.turn).toBe(baseBattleState.turn);
    expect(result.events).toEqual(baseBattleState.events);
    expect(result.a).toEqual(baseBattleState.a);
    expect(result.b).toEqual(baseBattleState.b);
  });

  // ─── non-object response guard ────────────────────────────────────────────

  it("throws when platform returns null", async () => {
    getMatchStateMock.mockResolvedValue(null);

    await expect(
      trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" })
    ).rejects.toThrow("getMatchState: unexpected non-object response from platform");
  });

  it("throws when platform returns undefined", async () => {
    getMatchStateMock.mockResolvedValue(undefined);

    await expect(
      trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" })
    ).rejects.toThrow("getMatchState: unexpected non-object response from platform");
  });

  it("throws when platform returns a string", async () => {
    getMatchStateMock.mockResolvedValue("ok");

    await expect(
      trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" })
    ).rejects.toThrow("getMatchState: unexpected non-object response from platform");
  });

  // ─── since_turn passthrough ───────────────────────────────────────────────

  it("passes since_turn to getMatchState when provided", async () => {
    getMatchStateMock.mockResolvedValue({ ...baseBattleState });

    await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001", since_turn: 2 });

    expect(getMatchStateMock).toHaveBeenCalledWith("01HMATCH00000000000000001", 2);
  });

  it("passes undefined since_turn to getMatchState when omitted", async () => {
    getMatchStateMock.mockResolvedValue({ ...baseBattleState });

    await trainerGetStateTool.handler({ match_id: "01HMATCH00000000000000001" });

    expect(getMatchStateMock).toHaveBeenCalledWith("01HMATCH00000000000000001", undefined);
  });
});
