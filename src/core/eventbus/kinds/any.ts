import type { Cursor, Filter, VaultEvent, WaitResult, WaiterKindBehavior } from "../types.js";
import { matchFilter } from "../match.js";

type AnyState = { event?: VaultEvent; matched_filter_index?: number };

export const anyBehavior: WaiterKindBehavior<AnyState> = {
  init(filters, caughtUp): AnyState {
    for (const ev of caughtUp) {
      for (let i = 0; i < filters.length; i++) {
        if (matchFilter(filters[i], ev)) return { event: ev, matched_filter_index: i };
      }
    }
    return {};
  },
  update(state, event, matchedFilterIndex): AnyState {
    if (state.event) return state;
    return { event, matched_filter_index: matchedFilterIndex };
  },
  isSatisfied(state): boolean { return state.event !== undefined; },
  toResult(state, timedOut, cursor): WaitResult {
    return state.event !== undefined
      ? { event: state.event, matched_filter_index: state.matched_filter_index, cursor, timed_out: timedOut }
      : { cursor, timed_out: timedOut };
  },
};
