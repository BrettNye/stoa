import { readFileSync } from "node:fs";
import { parseFrontmatter } from "../frontmatter.js";
import { matchers } from "./matchers/index.js";
import { StateCache } from "./state-cache.js";
import { EventBus } from "./bus.js";
import type { ParsedPage, VaultEvent } from "./types.js";

export interface EventDeriverConfig {
  vaultPath: string;
  bus: EventBus;
  stateCache: StateCache;
  onParseError?: (path: string, err: unknown) => void;
}

export class EventDeriver {
  constructor(private cfg: EventDeriverConfig) {}

  derive(absPath: string, changeKind: "add" | "change"): void {
    let claim: { source: string; key: { wiki: string; id: string } } | null = null;
    let matcher: (typeof matchers)[number] | null = null;
    for (const m of matchers) {
      const k = m.deriveKey(absPath, this.cfg.vaultPath);
      if (k) {
        claim = { source: m.source, key: k };
        matcher = m;
        break;
      }
    }
    if (!matcher || !claim) return;

    let parsed: ParsedPage;
    try {
      parsed = parseFrontmatter(readFileSync(absPath, "utf8"));
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return;
      this.cfg.onParseError?.(absPath, err);
      return;
    }

    const prev = this.cfg.stateCache.get(
      claim.source,
      claim.key.wiki,
      claim.key.id,
    );
    const decision = matcher.decide(parsed, prev as never, changeKind);

    if (matcher.nextState) {
      this.cfg.stateCache.set(
        claim.source,
        claim.key.wiki,
        claim.key.id,
        matcher.nextState(parsed),
      );
    }

    if (!decision.emit) return;

    const event: VaultEvent = {
      source: claim.source,
      wiki: claim.key.wiki,
      id: claim.key.id,
      path: absPath,
      change_kind: changeKind,
      mtime: new Date().toISOString(),
      ...decision.enrichment,
    };
    this.cfg.bus.emit(event);
  }

  warmStateCache(absPaths: string[]): void {
    for (const absPath of absPaths) {
      for (const m of matchers) {
        if (!m.init) continue;
        const k = m.deriveKey(absPath, this.cfg.vaultPath);
        if (!k) continue;
        try {
          const parsed = parseFrontmatter(readFileSync(absPath, "utf8"));
          this.cfg.stateCache.set(
            m.source,
            k.wiki,
            k.id,
            m.init(absPath, parsed),
          );
        } catch {
          /* skip warmup on parse error or missing file */
        }
        break;
      }
    }
  }
}
