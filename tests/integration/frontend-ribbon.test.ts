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
// app.js: stuckTasks getter
// ---------------------------------------------------------------------------

describe("frontend-ribbon: app.js — stuckTasks getter", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("declares stuckThresholds with claimed:15 and in_progress:45", () => {
    expect(js).toContain("stuckThresholds:");
    expect(js).toContain("claimed: 15");
    expect(js).toContain("in_progress: 45");
  });

  it("exposes get stuckTasks() getter", () => {
    expect(js).toContain("get stuckTasks()");
  });

  it("stuckTasks getter derives from this.tasks and this.channelEntries", () => {
    const fnIdx = js.indexOf("get stuckTasks()");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    // Find the matching closing brace — scan for the end of this getter
    // It will contain both this.tasks and this.channelEntries
    const snippet = js.slice(bodyStart, bodyStart + 1200);
    expect(snippet).toContain("this.tasks");
    expect(snippet).toContain("this.channelEntries");
  });

  it("stuckTasks getter annotates each row with _stuckMinutes", () => {
    const fnIdx = js.indexOf("get stuckTasks()");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1200);
    expect(snippet).toContain("_stuckMinutes");
  });

  it("stuckTasks getter filters only claimed and in_progress statuses", () => {
    const fnIdx = js.indexOf("get stuckTasks()");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1200);
    // Uses stuckThresholds to determine which statuses to process
    expect(snippet).toContain("stuckThresholds");
    // Skips tasks with no matching threshold (e.g. pending, completed)
    expect(snippet).toContain("continue");
  });

  it("stuckTasks checks channelEntries for recent posts on in_progress tasks with a channel", () => {
    const fnIdx = js.indexOf("get stuckTasks()");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1200);
    // Must check e.channel === t.channel pattern (or similar)
    expect(snippet).toContain("t.channel");
    // Must use channelEntries.some(...)
    expect(snippet).toMatch(/channelEntries\.some\b/);
  });

  it("stuckTasks spreads task object when pushing to output array", () => {
    const fnIdx = js.indexOf("get stuckTasks()");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1200);
    // Spreads task: { ...t, _stuckMinutes: ageMin }
    expect(snippet).toContain("...t");
  });
});

// ---------------------------------------------------------------------------
// app.js: releaseStuckTask() method
// ---------------------------------------------------------------------------

describe("frontend-ribbon: app.js — releaseStuckTask()", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("defines async releaseStuckTask(task) method", () => {
    expect(js).toContain("async releaseStuckTask(");
  });

  it("releaseStuckTask POSTs to /api/tasks/:id/release", () => {
    const fnIdx = js.indexOf("async releaseStuckTask(");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1000);
    expect(snippet).toContain("/api/tasks/");
    expect(snippet).toContain("/release");
    expect(snippet).toContain("POST");
  });

  it("releaseStuckTask sends expected_updated, wiki, reason in body", () => {
    const fnIdx = js.indexOf("async releaseStuckTask(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1000);
    expect(snippet).toContain("expected_updated");
    expect(snippet).toContain("wiki");
    expect(snippet).toContain("reason");
  });

  it("releaseStuckTask handles 409 (NotClaimed) with flashError", () => {
    const fnIdx = js.indexOf("async releaseStuckTask(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1000);
    expect(snippet).toContain("409");
    expect(snippet).toContain("not in claimed state");
    expect(snippet).toContain("flashError");
  });

  it("releaseStuckTask handles 412 (OccMismatch) with flashError", () => {
    const fnIdx = js.indexOf("async releaseStuckTask(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1000);
    expect(snippet).toContain("412");
    expect(snippet).toContain("task changed");
    expect(snippet).toContain("flashError");
  });

  it("releaseStuckTask calls this.refresh() on success", () => {
    const fnIdx = js.indexOf("async releaseStuckTask(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1000);
    expect(snippet).toContain("this.refresh()");
  });

  it("releaseStuckTask uses _releaseLoading per-row flag to gate concurrent calls", () => {
    const fnIdx = js.indexOf("async releaseStuckTask(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1000);
    expect(snippet).toContain("_releaseLoading");
  });

  it("releaseStuckTask clears _releaseLoading in finally block", () => {
    const fnIdx = js.indexOf("async releaseStuckTask(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 1000);
    expect(snippet).toContain("finally");
    // _releaseLoading must be set to false in finally
    const finallyIdx = snippet.indexOf("finally");
    const finallyBlock = snippet.slice(finallyIdx, finallyIdx + 200);
    expect(finallyBlock).toContain("_releaseLoading = false");
  });
});

// ---------------------------------------------------------------------------
// app.js: pingChannel() method
// ---------------------------------------------------------------------------

describe("frontend-ribbon: app.js — pingChannel()", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("defines async pingChannel(task) method", () => {
    expect(js).toContain("async pingChannel(");
  });

  it("pingChannel POSTs to /api/channels/:channel/posts", () => {
    const fnIdx = js.indexOf("async pingChannel(");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 700);
    expect(snippet).toContain("/api/channels/");
    expect(snippet).toContain("/posts");
    expect(snippet).toContain("POST");
  });

  it("pingChannel includes idle duration and claimer in content", () => {
    const fnIdx = js.indexOf("async pingChannel(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 700);
    expect(snippet).toContain("claimed_by");
    // Should include idle duration calculation
    expect(snippet).toContain("Date.now()");
  });

  it("pingChannel returns early when task has no channel", () => {
    const fnIdx = js.indexOf("async pingChannel(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 700);
    expect(snippet).toContain("task.channel");
    // Guards at the start
    expect(snippet).toContain("return");
  });

  it("pingChannel uses _pingLoading per-row flag", () => {
    const fnIdx = js.indexOf("async pingChannel(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 700);
    expect(snippet).toContain("_pingLoading");
  });

  it("pingChannel clears _pingLoading in finally block", () => {
    const fnIdx = js.indexOf("async pingChannel(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 700);
    expect(snippet).toContain("finally");
    const finallyIdx = snippet.indexOf("finally");
    const finallyBlock = snippet.slice(finallyIdx, finallyIdx + 200);
    expect(finallyBlock).toContain("_pingLoading = false");
  });

  it("pingChannel uses encodeURIComponent on task.channel", () => {
    const fnIdx = js.indexOf("async pingChannel(");
    const bodyStart = js.indexOf("{", fnIdx);
    const snippet = js.slice(bodyStart, bodyStart + 700);
    expect(snippet).toContain("encodeURIComponent(task.channel)");
  });
});

// ---------------------------------------------------------------------------
// index.html: watchdog ribbon section
// ---------------------------------------------------------------------------

describe("frontend-ribbon: index.html — watchdog ribbon", () => {
  let html: string;
  try {
    html = readStatic("index.html");
  } catch {
    html = "";
  }

  it("has <section class=\"watchdog\"> element", () => {
    expect(html).toContain('class="watchdog"');
  });

  it("watchdog section has x-show=\"stuckTasks.length > 0\"", () => {
    expect(html).toContain('x-show="stuckTasks.length > 0"');
  });

  it("watchdog section has a title showing stuck count", () => {
    expect(html).toContain("stuckTasks.length");
    expect(html).toContain("stuck");
  });

  it("watchdog section has x-for loop over stuckTasks", () => {
    expect(html).toMatch(/x-for="t in stuckTasks"/);
  });

  it("stuck-row items show task title as a link using taskHref(t)", () => {
    const watchdogIdx = html.indexOf('class="watchdog"');
    const watchdogSnippet = html.slice(watchdogIdx, watchdogIdx + 2000);
    expect(watchdogSnippet).toContain("taskHref(t)");
    expect(watchdogSnippet).toContain("t.title");
    expect(watchdogSnippet).toContain("stuck-title");
  });

  it("stuck-row shows claimer and idle duration", () => {
    const watchdogIdx = html.indexOf('class="watchdog"');
    const watchdogSnippet = html.slice(watchdogIdx, watchdogIdx + 2000);
    expect(watchdogSnippet).toContain("t.claimed_by");
    expect(watchdogSnippet).toContain("_stuckMinutes");
    expect(watchdogSnippet).toContain("stuck-claimer");
    expect(watchdogSnippet).toContain("stuck-idle");
  });

  it("stuck-row has a release button calling releaseStuckTask(t)", () => {
    const watchdogIdx = html.indexOf('class="watchdog"');
    const watchdogSnippet = html.slice(watchdogIdx, watchdogIdx + 2000);
    expect(watchdogSnippet).toContain("releaseStuckTask(t)");
    expect(watchdogSnippet).toContain("_releaseLoading");
  });

  it("stuck-row has a ping button calling pingChannel(t)", () => {
    const watchdogIdx = html.indexOf('class="watchdog"');
    const watchdogSnippet = html.slice(watchdogIdx, watchdogIdx + 2000);
    expect(watchdogSnippet).toContain("pingChannel(t)");
    expect(watchdogSnippet).toContain("_pingLoading");
  });

  it("ping button is disabled when task has no channel", () => {
    const watchdogIdx = html.indexOf('class="watchdog"');
    const watchdogSnippet = html.slice(watchdogIdx, watchdogIdx + 2000);
    // :disabled should reference !t.channel
    expect(watchdogSnippet).toContain("!t.channel");
  });

  it("watchdog section appears between header and main.grid", () => {
    const headerEnd = html.indexOf("</header>");
    const mainStart = html.indexOf('<main class="grid">');
    const watchdogIdx = html.indexOf('class="watchdog"');
    expect(headerEnd).toBeGreaterThan(-1);
    expect(mainStart).toBeGreaterThan(headerEnd);
    expect(watchdogIdx).toBeGreaterThan(headerEnd);
    expect(watchdogIdx).toBeLessThan(mainStart);
  });
});

// ---------------------------------------------------------------------------
// styles.css: watchdog / stuck-row styles
// ---------------------------------------------------------------------------

describe("frontend-ribbon: styles.css — watchdog styles", () => {
  let css: string;
  try {
    css = readStatic("styles.css");
  } catch {
    css = "";
  }

  it("has .watchdog rule", () => {
    expect(css).toContain(".watchdog");
  });

  it(".watchdog uses var(--color-red) for border", () => {
    const watchdogIdx = css.indexOf(".watchdog {");
    expect(watchdogIdx).toBeGreaterThan(-1);
    const blockStart = css.indexOf("{", watchdogIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("var(--color-red)");
  });

  it(".watchdog uses var(--color-surface) for background (no new colour)", () => {
    const watchdogIdx = css.indexOf(".watchdog {");
    const blockStart = css.indexOf("{", watchdogIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("var(--color-surface)");
  });

  it("has .watchdog-title rule with var(--color-red) color", () => {
    expect(css).toContain(".watchdog-title");
    const titleIdx = css.indexOf(".watchdog-title");
    const blockStart = css.indexOf("{", titleIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("var(--color-red)");
    expect(block).toContain("font-weight");
  });

  it("has .stuck-row rule with grid layout", () => {
    expect(css).toContain(".stuck-row");
    const rowIdx = css.indexOf(".stuck-row {");
    const blockStart = css.indexOf("{", rowIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("grid");
    expect(block).toContain("align-items: center");
  });

  it("has .stuck-title class referenced in CSS", () => {
    expect(css).toContain("stuck-title");
  });

  it("has .stuck-claimer or .stuck-idle referenced in CSS (or at minimum .stuck-row button styles)", () => {
    // At least stuck-row button styling is present
    expect(css).toMatch(/stuck-row button|stuck-row\s*\{/);
  });

  it("no new CSS colour variables introduced (uses only existing --color-* vars)", () => {
    // Find only the watchdog section additions — check that no new --color-* variables are defined
    // Check :root block has not grown with new watchdog-specific variables
    const rootIdx = css.indexOf(":root");
    const rootStart = css.indexOf("{", rootIdx);
    const rootEnd = css.indexOf("}", rootStart);
    const rootBlock = css.slice(rootStart, rootEnd);
    // The root block should NOT contain watchdog-specific color variables
    expect(rootBlock).not.toContain("--color-watchdog");
    expect(rootBlock).not.toContain("--color-stuck");
  });
});

// ---------------------------------------------------------------------------
// Regression: existing functionality is untouched
// ---------------------------------------------------------------------------

describe("frontend-ribbon: regression — pre-existing behaviour preserved", () => {
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

  it("app.js still has refresh() method with Promise.all", () => {
    expect(js).toContain("async refresh()");
    expect(js).toContain("Promise.all");
  });

  it("app.js still has claim() method", () => {
    expect(js).toContain("async claim(");
  });

  it("app.js still has post() method for channel composer", () => {
    expect(js).toContain("async post()");
  });

  it("app.js still has hydrateFromHash / syncToHash / pinnedViews session state", () => {
    expect(js).toContain("hydrateFromHash");
    expect(js).toContain("syncToHash");
    expect(js).toContain("pinnedViews");
  });

  it("index.html main.grid and three-pane structure are intact", () => {
    expect(html).toContain('<main class="grid">');
    expect(html).toMatch(/class="[^"]*pane[^"]*agents[^"]*"/);
    expect(html).toMatch(/class="[^"]*pane[^"]*tasks[^"]*"/);
    expect(html).toMatch(/class="[^"]*pane[^"]*channels[^"]*"/);
  });

  it("css still has main.grid rule", () => {
    expect(css).toContain("main.grid");
  });

  it("css still has .pane class", () => {
    expect(css).toContain(".pane");
  });
});
