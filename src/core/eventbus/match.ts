import type { Filter, VaultEvent } from "./types.js";

export function matchFilter(filter: Filter, event: VaultEvent): boolean {
  if (filter.source !== event.source) return false;
  if (filter.wiki !== undefined && filter.wiki !== event.wiki) return false;
  if (filter.id !== undefined && filter.id !== event.id) return false;
  if (filter.channel !== undefined) {
    if (event.source !== "journal") return false;
    if (event.channel !== filter.channel) return false;
  }
  return true;
}
