export type VaultEvent = {
  source: string;
  wiki: string;
  id: string;
  path: string;
  change_kind: "add" | "change" | "internal";
  mtime: string;
  channel?: string;
  task_status_change?: { from: string | null; to: string | null };
  task_owner_change?: { from: string | null; to: string | null };
};

export type Filter = {
  source: string;
  wiki?: string;
  channel?: string;
  id?: string;
};

declare const cursorBrand: unique symbol;
export type Cursor = string & { readonly [cursorBrand]: never };

export const Cursor = {
  fromIso: (iso: string): Cursor => iso as Cursor,
  toIso: (c: Cursor): string => c as string,
};

export type WaitResult =
  | { event?: VaultEvent; cursor: Cursor; timed_out: boolean }
  | { event?: VaultEvent; matched_filter_index?: number; cursor: Cursor; timed_out: boolean }
  | { events: VaultEvent[]; missing_filter_indices?: number[]; cursor: Cursor; timed_out: boolean }
  | { events: VaultEvent[]; cursor: Cursor; timed_out: boolean };

export type ParsedPage = {
  frontmatter: Record<string, unknown>;
  body: string;
};

export interface SourceMatcher<TState = void> {
  source: string;
  globs: string[];
  deriveKey(absPath: string, vaultPath: string):
    { wiki: string; id: string } | null;
  decide(
    parsed: ParsedPage,
    prevState: TState | undefined,
    changeKind: "add" | "change",
  ): { emit: boolean; enrichment?: Partial<VaultEvent> };
  nextState?(parsed: ParsedPage): TState;
  init?(absPath: string, parsed: ParsedPage): TState;
}

export interface WaiterKindBehavior<S> {
  init(filters: Filter[], caughtUp: VaultEvent[]): S;
  update(state: S, event: VaultEvent, matchedFilterIndex: number): S;
  isSatisfied(state: S): boolean;
  toResult(state: S, timedOut: boolean, cursor: Cursor): WaitResult;
}
