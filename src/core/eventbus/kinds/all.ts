import type { Cursor, Filter, VaultEvent, WaitResult, WaiterKindBehavior } from "../types.js";
import { matchFilter } from "../match.js";

export type AllState = {
  events: (VaultEvent | null)[];
  resolved: Set<number>;
  filterCount: number;
};

export const allBehavior: WaiterKindBehavior<AllState> = {
  init(filters: Filter[], caughtUp: VaultEvent[]): AllState {
    const events: (VaultEvent | null)[] = filters.map(() => null);
    const resolved = new Set<number>();
    for (const ev of caughtUp) {
      for (let i = 0; i < filters.length; i++) {
        if (!resolved.has(i) && matchFilter(filters[i], ev)) {
          events[i] = ev;
          resolved.add(i);
        }
      }
    }
    return { events, resolved, filterCount: filters.length };
  },

  update(state: AllState, event: VaultEvent, matchedFilterIndex: number): AllState {
    if (state.resolved.has(matchedFilterIndex)) return state;
    const events = [...state.events];
    events[matchedFilterIndex] = event;
    const resolved = new Set(state.resolved);
    resolved.add(matchedFilterIndex);
    return { ...state, events, resolved };
  },

  isSatisfied(state: AllState): boolean {
    return state.resolved.size === state.filterCount;
  },

  toResult(state: AllState, timedOut: boolean, cursor: Cursor): WaitResult {
    const missing: number[] = [];
    for (let i = 0; i < state.filterCount; i++) {
      if (!state.resolved.has(i)) missing.push(i);
    }
    const events = state.events.filter((e): e is VaultEvent => e !== null);
    return missing.length > 0
      ? { events, missing_filter_indices: missing, cursor, timed_out: timedOut }
      : { events, cursor, timed_out: timedOut };
  },
};
