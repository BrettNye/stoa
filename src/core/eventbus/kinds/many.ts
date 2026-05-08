import type { Cursor, Filter, VaultEvent, WaitResult, WaiterKindBehavior } from "../types.js";
import { matchFilter } from "../match.js";

type ManyState = { events: VaultEvent[]; max: number };

export function makeManyBehavior(max: number): WaiterKindBehavior<ManyState> {
  return {
    init(filters: Filter[], caughtUp: VaultEvent[]): ManyState {
      const events: VaultEvent[] = [];
      for (const ev of caughtUp) {
        if (events.length >= max) break;
        if (matchFilter(filters[0], ev)) events.push(ev);
      }
      return { events, max };
    },
    update(state: ManyState, event: VaultEvent, _idx: number): ManyState {
      if (state.events.length >= state.max) return state;
      return { ...state, events: [...state.events, event] };
    },
    isSatisfied(state: ManyState): boolean {
      return state.events.length >= state.max;
    },
    toResult(state: ManyState, timedOut: boolean, cursor: Cursor): WaitResult {
      return { events: state.events, cursor, timed_out: timedOut };
    },
  };
}
