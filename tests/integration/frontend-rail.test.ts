import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticDir = join(__dirname, "../../src/transport/ui/static");

function readStatic(name: string): string {
  return readFileSync(join(staticDir, name), "utf8");
}

// ---------------------------------------------------------------------------
// app.js: syntheses state + fetch
// ---------------------------------------------------------------------------

describe("frontend-rail: app.js — syntheses state", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("declares syntheses: [] state", () => {
    expect(js).toContain("syntheses:");
    // Must be an empty array initialisation
    expect(js).toMatch(/syntheses:\s*\[\]/);
  });

  it("refresh() fetches /api/syntheses/staleness as the 6th endpoint", () => {
    expect(js).toContain("/api/syntheses/staleness");
  });

  it("refresh() uses Promise.all that now includes the staleness fetch", () => {
    // Verify Promise.all still present and staleness endpoint is inside the parallel block
    const refreshIdx = js.indexOf("async refresh()");
    expect(refreshIdx).toBeGreaterThan(-1);
    const refreshEnd = js.indexOf("async refresh()", refreshIdx + 1);
    // Slice from refresh start to next async method (or end of function)
    const snippet = js.slice(refreshIdx, refreshEnd === -1 ? refreshIdx + 3000 : refreshEnd);
    expect(snippet).toContain("Promise.all");
    expect(snippet).toContain("/api/syntheses/staleness");
  });

  it("refresh() unwraps body.syntheses (not a bare array) from the staleness response", () => {
    const refreshIdx = js.indexOf("async refresh()");
    const snippet = js.slice(refreshIdx, refreshIdx + 3000);
    // Must unwrap via body.syntheses pattern
    expect(snippet).toContain("syntheses");
    // Check for the unwrap pattern: body.syntheses or similar
    expect(snippet).toMatch(/\.syntheses\b/);
  });

  it("refresh() assigns to this.syntheses", () => {
    const refreshIdx = js.indexOf("async refresh()");
    const snippet = js.slice(refreshIdx, refreshIdx + 3000);
    expect(snippet).toContain("this.syntheses");
  });
});

// ---------------------------------------------------------------------------
// app.js: freshnessClass() helper
// ---------------------------------------------------------------------------

describe("frontend-rail: app.js — freshnessClass()", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("defines freshnessClass(s) method", () => {
    expect(js).toContain("freshnessClass(");
  });

  it("freshnessClass returns freshness-never when lag_days is null", () => {
    const fnIdx = js.indexOf("freshnessClass(");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 400);
    expect(snippet).toContain("freshness-never");
    expect(snippet).toMatch(/null|=== null/);
  });

  it("freshnessClass returns freshness-fresh when lag_days < 30", () => {
    const fnIdx = js.indexOf("freshnessClass(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 400);
    expect(snippet).toContain("freshness-fresh");
    expect(snippet).toContain("30");
  });

  it("freshnessClass returns freshness-mid when lag_days < 90", () => {
    const fnIdx = js.indexOf("freshnessClass(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 400);
    expect(snippet).toContain("freshness-mid");
    expect(snippet).toContain("90");
  });

  it("freshnessClass returns freshness-stale when lag_days >= 90", () => {
    const fnIdx = js.indexOf("freshnessClass(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 400);
    expect(snippet).toContain("freshness-stale");
  });
});

// ---------------------------------------------------------------------------
// app.js: freshnessLabel() helper
// ---------------------------------------------------------------------------

describe("frontend-rail: app.js — freshnessLabel()", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("defines freshnessLabel(s) method", () => {
    expect(js).toContain("freshnessLabel(");
  });

  it("freshnessLabel returns 'never compiled' when lag_days is null", () => {
    const fnIdx = js.indexOf("freshnessLabel(");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 300);
    expect(snippet).toContain("never compiled");
  });

  it("freshnessLabel includes lag_days value in output", () => {
    const fnIdx = js.indexOf("freshnessLabel(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 300);
    expect(snippet).toContain("lag_days");
  });
});

// ---------------------------------------------------------------------------
// app.js: synthesisHref() helper
// ---------------------------------------------------------------------------

describe("frontend-rail: app.js — synthesisHref()", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("defines synthesisHref(s) method", () => {
    expect(js).toContain("synthesisHref(");
  });

  it("synthesisHref produces obsidian:// URI", () => {
    const fnIdx = js.indexOf("synthesisHref(");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 400);
    expect(snippet).toContain("obsidian://");
  });

  it("synthesisHref uses encodeURIComponent on vault and file path", () => {
    const fnIdx = js.indexOf("synthesisHref(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 400);
    expect(snippet).toContain("encodeURIComponent");
    // Must encode both vault and file (two calls)
    const matches = snippet.match(/encodeURIComponent/g);
    expect(matches).not.toBeNull();
    expect((matches || []).length).toBeGreaterThanOrEqual(2);
  });

  it("synthesisHref constructs path as wikis/<wiki>/synthesis/<id>.md", () => {
    const fnIdx = js.indexOf("synthesisHref(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 400);
    expect(snippet).toContain("synthesis");
    expect(snippet).toContain("s.wiki");
    expect(snippet).toContain("s.id");
    // Path pattern: wikis/${s.wiki}/synthesis/${s.id}.md
    expect(snippet).toMatch(/wikis.*synthesis/);
  });

  it("synthesisHref uses this.vaultBaseName (same pattern as taskHref/channelHref)", () => {
    const fnIdx = js.indexOf("synthesisHref(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 400);
    expect(snippet).toContain("this.vaultBaseName");
  });
});

// ---------------------------------------------------------------------------
// index.html: staleness pane/rail
// ---------------------------------------------------------------------------

describe("frontend-rail: index.html — staleness pane", () => {
  let html: string;
  try {
    html = readStatic("index.html");
  } catch {
    html = "";
  }

  it("has <section class containing 'staleness'>", () => {
    expect(html).toMatch(/class="[^"]*staleness[^"]*"/);
  });

  it("staleness section has x-show conditional on syntheses.length > 0", () => {
    const sectionIdx = html.search(/class="[^"]*staleness[^"]*"/);
    expect(sectionIdx).toBeGreaterThan(-1);
    // Check near the section open tag for x-show
    const sectionTag = html.slice(Math.max(0, sectionIdx - 100), sectionIdx + 300);
    expect(sectionTag).toContain("syntheses.length");
  });

  it("staleness section has Stale syntheses heading", () => {
    const sectionIdx = html.search(/class="[^"]*staleness[^"]*"/);
    const sectionSnippet = html.slice(sectionIdx, sectionIdx + 2500);
    expect(sectionSnippet).toMatch(/[Ss]tale/);
    expect(sectionSnippet).toMatch(/[Ss]ynthes/);
  });

  it("staleness section has x-for loop over syntheses", () => {
    expect(html).toMatch(/x-for="s in syntheses"/);
  });

  it("staleness row shows freshness badge with freshnessClass(s)", () => {
    const forIdx = html.indexOf('x-for="s in syntheses"');
    expect(forIdx).toBeGreaterThan(-1);
    const rowSnippet = html.slice(forIdx, forIdx + 1500);
    expect(rowSnippet).toContain("freshnessClass(s)");
    expect(rowSnippet).toContain("freshness-badge");
  });

  it("staleness row renders synthesis title as a link using synthesisHref(s)", () => {
    const forIdx = html.indexOf('x-for="s in syntheses"');
    const rowSnippet = html.slice(forIdx, forIdx + 1500);
    expect(rowSnippet).toContain("synthesisHref(s)");
    expect(rowSnippet).toContain("s.title");
  });

  it("staleness row shows wiki and lag_days", () => {
    const forIdx = html.indexOf('x-for="s in syntheses"');
    const rowSnippet = html.slice(forIdx, forIdx + 1500);
    expect(rowSnippet).toContain("s.wiki");
    expect(rowSnippet).toContain("lag_days");
  });

  it("staleness row shows stale_inputs moved count", () => {
    const forIdx = html.indexOf('x-for="s in syntheses"');
    const rowSnippet = html.slice(forIdx, forIdx + 1500);
    expect(rowSnippet).toContain("stale_inputs");
  });
});

// ---------------------------------------------------------------------------
// styles.css: staleness / freshness styles
// ---------------------------------------------------------------------------

describe("frontend-rail: styles.css — staleness styles", () => {
  let css: string;
  try {
    css = readStatic("styles.css");
  } catch {
    css = "";
  }

  it("has .staleness-row rule", () => {
    expect(css).toContain(".staleness-row");
  });

  it(".staleness-row uses grid layout", () => {
    const rowIdx = css.indexOf(".staleness-row {");
    expect(rowIdx).toBeGreaterThan(-1);
    const blockStart = css.indexOf("{", rowIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("grid");
  });

  it("has .staleness-title rule", () => {
    expect(css).toContain("staleness-title");
  });

  it("has .staleness-wiki rule", () => {
    expect(css).toContain("staleness-wiki");
  });

  it("has .staleness-lag rule", () => {
    expect(css).toContain("staleness-lag");
  });

  it("has .freshness-badge rule", () => {
    expect(css).toContain(".freshness-badge");
  });

  it("freshness-badge is a small rounded element (border-radius: 50%)", () => {
    const badgeIdx = css.indexOf(".freshness-badge {");
    expect(badgeIdx).toBeGreaterThan(-1);
    const blockStart = css.indexOf("{", badgeIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("border-radius");
    expect(block).toContain("50%");
  });

  it("has .freshness-fresh rule using var(--color-green)", () => {
    expect(css).toContain(".freshness-fresh");
    const idx = css.indexOf(".freshness-fresh");
    const blockStart = css.indexOf("{", idx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("var(--color-green)");
  });

  it("has .freshness-mid rule using var(--color-yellow)", () => {
    expect(css).toContain(".freshness-mid");
    const idx = css.indexOf(".freshness-mid");
    const blockStart = css.indexOf("{", idx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("var(--color-yellow)");
  });

  it("has .freshness-stale rule using var(--color-red)", () => {
    expect(css).toContain(".freshness-stale");
    const idx = css.indexOf(".freshness-stale");
    const blockStart = css.indexOf("{", idx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("var(--color-red)");
  });

  it("has .freshness-never rule using var(--color-gray)", () => {
    expect(css).toContain(".freshness-never");
    const idx = css.indexOf(".freshness-never");
    const blockStart = css.indexOf("{", idx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("var(--color-gray)");
  });

  it("no new CSS colour variables introduced in :root", () => {
    const rootIdx = css.indexOf(":root");
    const rootStart = css.indexOf("{", rootIdx);
    const rootEnd = css.indexOf("}", rootStart);
    const rootBlock = css.slice(rootStart, rootEnd);
    expect(rootBlock).not.toContain("--color-staleness");
    expect(rootBlock).not.toContain("--color-freshness");
  });
});

// ---------------------------------------------------------------------------
// Behavioral: fetch list grows from 5 to 6 endpoints
// ---------------------------------------------------------------------------

describe("frontend-rail: behavioral — fetch list is now 6 endpoints", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("refresh() includes /api/syntheses/staleness alongside the original 5 endpoints", () => {
    // Original 5: /api/health, /api/tasks, /api/agents, /api/channels, /api/wikis
    expect(js).toContain("/api/health");
    expect(js).toContain("/api/tasks");
    expect(js).toContain("/api/agents");
    expect(js).toContain("/api/channels");
    expect(js).toContain("/api/wikis");
    expect(js).toContain("/api/syntheses/staleness");
  });

  it("Promise.all in refresh() captures 6 results (destructure has 6 elements)", () => {
    const refreshIdx = js.indexOf("async refresh()");
    expect(refreshIdx).toBeGreaterThan(-1);
    const snippet = js.slice(refreshIdx, refreshIdx + 3000);
    // Should have a destructure pattern with 6 items
    // Look for [a, b, c, d, e, f] = await Promise.all pattern
    const promiseAllIdx = snippet.indexOf("Promise.all");
    expect(promiseAllIdx).toBeGreaterThan(-1);
    // The destructure should include stalenessRes or similar as 6th item
    const beforePromiseAll = snippet.slice(0, promiseAllIdx);
    // Count the destructure elements by looking for the const [ pattern
    const destructureMatch = beforePromiseAll.match(/const\s*\[([^\]]+)\]/);
    if (destructureMatch) {
      const elements = destructureMatch[1].split(",").filter(s => s.trim().length > 0);
      expect(elements.length).toBeGreaterThanOrEqual(6);
    }
    // Alternatively, just verify staleness is in the same Promise.all block
    const promiseAllBlock = snippet.slice(promiseAllIdx, promiseAllIdx + 500);
    expect(promiseAllBlock).toContain("syntheses");
  });
});

// ---------------------------------------------------------------------------
// Regression: pre-existing functionality is untouched
// ---------------------------------------------------------------------------

describe("frontend-rail: regression — pre-existing behaviour preserved", () => {
  let js: string;
  let html: string;
  let css: string;
  try {
    js = readStatic("app.js");
    html = readStatic("index.html");
    css = readStatic("styles.css");
  } catch {
    js = "";
    html = "";
    css = "";
  }

  it("app.js still has filteredTasks getter", () => {
    expect(js).toContain("get filteredTasks()");
  });

  it("app.js still has stuckTasks getter", () => {
    expect(js).toContain("get stuckTasks()");
  });

  it("app.js still has releaseStuckTask() method", () => {
    expect(js).toContain("async releaseStuckTask(");
  });

  it("app.js still has pingChannel() method", () => {
    expect(js).toContain("async pingChannel(");
  });

  it("app.js still has hydrateFromHash / syncToHash / pinnedViews session state", () => {
    expect(js).toContain("hydrateFromHash");
    expect(js).toContain("syncToHash");
    expect(js).toContain("pinnedViews");
  });

  it("index.html still has watchdog ribbon section", () => {
    expect(html).toContain('class="watchdog"');
    expect(html).toContain("stuckTasks.length");
  });

  it("index.html still has three-pane structure (agents, tasks, channels)", () => {
    expect(html).toContain('<main class="grid">');
    expect(html).toMatch(/class="[^"]*pane[^"]*agents[^"]*"/);
    expect(html).toMatch(/class="[^"]*pane[^"]*tasks[^"]*"/);
    expect(html).toMatch(/class="[^"]*pane[^"]*channels[^"]*"/);
  });

  it("css still has main.grid rule with minmax columns (no horizontal overflow)", () => {
    expect(css).toContain("main.grid");
    // Must use minmax(0, ...) columns to avoid overflow
    expect(css).toContain("minmax(0,");
  });

  it("css still has .pane class", () => {
    expect(css).toContain(".pane");
  });

  it("css still has .watchdog class", () => {
    expect(css).toContain(".watchdog");
  });
});
