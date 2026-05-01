import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  lintCheckRegistry,
  registerLintCheck,
  runRegisteredChecks,
  type LintCheck,
  type LintCheckCtx
} from "../../src/core/lint-check.js";
import type { Diagnostic, LintInput } from "../../src/core/lint.js";
import type { VaultIndex } from "../../src/core/index.js";

// Hermeticity: snapshot registry length and splice back to it after each test.
// The registry is module-level mutable state; Wave 1 Task 1-5 will register
// real stub checks via side-effect imports, and these tests must not pollute
// what those imports see.
describe("lint-check registry", () => {
  let initialLength: number;

  beforeEach(() => {
    initialLength = lintCheckRegistry.length;
  });

  afterEach(() => {
    lintCheckRegistry.splice(initialLength, lintCheckRegistry.length - initialLength);
  });

  const emptyIdx: VaultIndex = { wikis: [], pages: [], links: {} };
  const emptyInput: LintInput = {};
  const baseCtx: LintCheckCtx = { vaultPath: "/tmp/vault" };

  it("returns [] when no checks are registered", () => {
    expect(runRegisteredChecks(baseCtx, emptyIdx, emptyInput)).toEqual([]);
  });

  it("returns diagnostics from two registered checks in registration order", () => {
    const checkA: LintCheck = {
      code: "CHECK_A",
      run: () => [{ severity: "warning", code: "CHECK_A", message: "from a" }]
    };
    const checkB: LintCheck = {
      code: "CHECK_B",
      run: () => [{ severity: "error", code: "CHECK_B", message: "from b" }]
    };
    registerLintCheck(checkA);
    registerLintCheck(checkB);

    const result = runRegisteredChecks(baseCtx, emptyIdx, emptyInput);
    expect(result).toHaveLength(2);
    expect(result[0].code).toBe("CHECK_A");
    expect(result[1].code).toBe("CHECK_B");
  });

  it("flat-maps multiple diagnostics from a single check", () => {
    const multi: LintCheck = {
      code: "MULTI",
      run: (): Diagnostic[] => [
        { severity: "info", code: "MULTI", message: "one" },
        { severity: "info", code: "MULTI", message: "two" },
        { severity: "info", code: "MULTI", message: "three" }
      ]
    };
    registerLintCheck(multi);

    const result = runRegisteredChecks(baseCtx, emptyIdx, emptyInput);
    expect(result).toHaveLength(3);
    expect(result.map(d => d.message)).toEqual(["one", "two", "three"]);
  });

  it("plumbs ctx.defaultWiki to checks", () => {
    let seen: string | undefined = "<unset>";
    const wikiAware: LintCheck = {
      code: "WIKI_AWARE",
      run: (ctx) => {
        seen = ctx.defaultWiki;
        return [];
      }
    };
    registerLintCheck(wikiAware);

    runRegisteredChecks(
      { vaultPath: "/tmp/vault", defaultWiki: "expected-wiki" },
      emptyIdx,
      emptyInput
    );
    expect(seen).toBe("expected-wiki");
  });

  it("plumbs ctx.fetcher (callable) to checks", () => {
    let fetcherCallable = false;
    const fetcherAware: LintCheck = {
      code: "FETCHER_AWARE",
      run: (ctx) => {
        fetcherCallable = typeof ctx.fetcher === "function";
        return [];
      }
    };
    registerLintCheck(fetcherAware);

    const fakeFetcher = (async () => new Response("")) as unknown as typeof fetch;
    runRegisteredChecks(
      { vaultPath: "/tmp/vault", fetcher: fakeFetcher },
      emptyIdx,
      emptyInput
    );
    expect(fetcherCallable).toBe(true);
  });

  it("registry length increases by exactly one per registerLintCheck call (smoke test for side-effect import pattern)", () => {
    const before = lintCheckRegistry.length;
    registerLintCheck({
      code: "SMOKE",
      run: () => []
    });
    expect(lintCheckRegistry.length).toBe(before + 1);

    registerLintCheck({
      code: "SMOKE_2",
      run: () => []
    });
    expect(lintCheckRegistry.length).toBe(before + 2);
  });
});
