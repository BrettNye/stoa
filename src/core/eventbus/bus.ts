import type { VaultEvent } from "./types.js";

export type Unsubscribe = () => void;
export type Handler = (event: VaultEvent) => void;

export class EventBus {
  private handlers = new Set<Handler>();

  emit(event: VaultEvent): void {
    for (const h of [...this.handlers]) {
      try { h(event); } catch { /* one bad handler must not silence the bus */ }
    }
  }

  subscribe(handler: Handler): Unsubscribe {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  get subscriberCount(): number {
    return this.handlers.size;
  }
}
