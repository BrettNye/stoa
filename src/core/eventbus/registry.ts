import type { Cursor, Filter, VaultEvent, WaiterKindBehavior, WaitResult } from "./types.js";
import { matchFilter } from "./match.js";
import type { EventBus, Unsubscribe } from "./bus.js";

export interface RegistryLimits {
  maxWaiters: number;
}

export class WaiterLimitExceededError extends Error {
  constructor(public attempted: number, public max: number) {
    super(`waiter limit exceeded: ${attempted} > ${max}`);
  }
}

interface Waiter<S> {
  id: string;
  filters: Filter[];
  behavior: WaiterKindBehavior<S>;
  state: S;
  deadline: number;
  resolve: (r: WaitResult) => void;
  resolved: boolean;
  timer: ReturnType<typeof setTimeout>;
}

export class WaiterRegistry {
  private waiters = new Map<string, Waiter<unknown>>();
  private unsubscribe: Unsubscribe;
  private nextId = 0;

  constructor(private bus: EventBus, private limits: RegistryLimits = { maxWaiters: 256 }) {
    this.unsubscribe = bus.subscribe(this.onEvent);
  }

  register<S>(
    filters: Filter[],
    behavior: WaiterKindBehavior<S>,
    initialState: S,
    timeoutMs: number,
    cursorAtDeadline: () => Cursor,
  ): Promise<WaitResult> {
    if (this.waiters.size >= this.limits.maxWaiters) {
      throw new WaiterLimitExceededError(this.waiters.size + 1, this.limits.maxWaiters);
    }
    const id = `w${++this.nextId}`;
    return new Promise<WaitResult>((resolve) => {
      const timer = setTimeout(() => {
        const w = this.waiters.get(id);
        if (!w || w.resolved) return;
        w.resolved = true;
        this.waiters.delete(id);
        resolve(behavior.toResult(w.state as S, true, cursorAtDeadline()));
      }, timeoutMs);
      this.waiters.set(id, {
        id,
        filters,
        behavior: behavior as WaiterKindBehavior<unknown>,
        state: initialState,
        deadline: Date.now() + timeoutMs,
        resolve,
        resolved: false,
        timer,
      });
    });
  }

  cancel(id: string): void {
    const w = this.waiters.get(id);
    if (!w || w.resolved) return;
    w.resolved = true;
    clearTimeout(w.timer);
    this.waiters.delete(id);
  }

  size(): number {
    return this.waiters.size;
  }

  close(): void {
    this.unsubscribe();
    for (const w of this.waiters.values()) {
      if (!w.resolved) {
        w.resolved = true;
        clearTimeout(w.timer);
        // Resolve with timed_out=true using a sentinel cursor so callers don't hang
        w.resolve(w.behavior.toResult(w.state, true, "closed" as unknown as Cursor));
      }
    }
    this.waiters.clear();
  }

  private onEvent = (event: VaultEvent): void => {
    for (const w of [...this.waiters.values()]) {
      if (w.resolved) continue;
      let matchedIndex = -1;
      for (let i = 0; i < w.filters.length; i++) {
        if (matchFilter(w.filters[i], event)) {
          matchedIndex = i;
          break;
        }
      }
      if (matchedIndex < 0) continue;
      w.state = w.behavior.update(w.state, event, matchedIndex);
      if (w.behavior.isSatisfied(w.state)) {
        w.resolved = true;
        clearTimeout(w.timer);
        this.waiters.delete(w.id);
        w.resolve(w.behavior.toResult(w.state, false, event.mtime as unknown as Cursor));
      }
    }
  };
}
