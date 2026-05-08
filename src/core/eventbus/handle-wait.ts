import type { Cursor, Filter, VaultEvent, WaitResult, WaiterKindBehavior } from "./types.js";
import { Cursor as CursorNs } from "./types.js";
import { catchupSince } from "./catchup.js";
import type { WaiterRegistry } from "./registry.js";
import type { EventBus } from "./bus.js";
import type { Watcher } from "./watcher.js";

export interface HandleWaitContext {
  vaultPath: string;
  bus: EventBus;
  registry: WaiterRegistry;
  watcher: Watcher;
}

export async function handleWait<S>(
  behavior: WaiterKindBehavior<S>,
  filters: Filter[],
  since: Cursor | undefined,
  timeoutMs: number,
  ctx: HandleWaitContext,
): Promise<WaitResult> {
  // Subscribe-before-scan: ensure watcher is up so live events firing during
  // the scan land in the bus and reach our pre-registered buffer.
  await ctx.watcher.start();

  // Pre-register a buffer that captures live events during the scan phase.
  const preBuffer: VaultEvent[] = [];
  const unsub = ctx.bus.subscribe((ev) => preBuffer.push(ev));

  // Scan FS for catch-up events.
  const { events: caughtUp, cursor: scanCursor } =
    await catchupSince(ctx.vaultPath, filters, since);

  // Drain pre-buffer + scan, dedup by (source, wiki, id, mtime), feed behavior.init.
  unsub();
  const merged = dedupe([...caughtUp, ...preBuffer]);
  const initialState = behavior.init(filters, merged);
  if (behavior.isSatisfied(initialState)) {
    return behavior.toResult(initialState, false, scanCursor);
  }

  // Otherwise register live waiter with deadline, pre-loaded with merged events.
  const cursorAtDeadline = (): Cursor => CursorNs.fromIso(new Date().toISOString());
  return ctx.registry.register(filters, behavior, initialState, timeoutMs, cursorAtDeadline);
}

function dedupe(events: VaultEvent[]): VaultEvent[] {
  const seen = new Set<string>();
  const out: VaultEvent[] = [];
  for (const e of events) {
    const k = `${e.source}|${e.wiki}|${e.id}|${e.mtime}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(e);
  }
  return out;
}
