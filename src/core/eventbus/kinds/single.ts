import type { Cursor, Filter, VaultEvent, WaitResult, WaiterKindBehavior } from "../types.js";

type SingleState = { event?: VaultEvent };

export const singleBehavior: WaiterKindBehavior<SingleState> = {
  init(_filters: Filter[], caughtUp: VaultEvent[]): SingleState {
    return { event: caughtUp[0] };
  },
  update(state: SingleState, event: VaultEvent, _matchedFilterIndex: number): SingleState {
    if (state.event) return state;
    return { event };
  },
  isSatisfied(state: SingleState): boolean {
    return state.event !== undefined;
  },
  toResult(state: SingleState, timedOut: boolean, cursor: Cursor): WaitResult {
    return { event: state.event, cursor, timed_out: timedOut };
  },
};
