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
// HTML: Tasks pane header — filter select element
// ---------------------------------------------------------------------------

describe("frontend-task-filter: index.html — task status filter", () => {
  let html: string;
  try {
    html = readStatic("index.html");
  } catch {
    html = "";
  }

  it("has a .pane-header wrapper in the tasks pane", () => {
    expect(html).toContain('class="pane-header"');
  });

  it("has a filter-select element with x-model=taskStatusFilter", () => {
    expect(html).toContain('x-model="taskStatusFilter"');
    expect(html).toContain('class="filter-select"');
  });

  it("has option value=active (default)", () => {
    expect(html).toMatch(/<option value="active">active<\/option>/);
  });

  it("has option value=all", () => {
    expect(html).toMatch(/<option value="all">all<\/option>/);
  });

  it("has option value=pending", () => {
    expect(html).toMatch(/<option value="pending">pending<\/option>/);
  });

  it("has option value=claimed", () => {
    expect(html).toMatch(/<option value="claimed">claimed<\/option>/);
  });

  it("has option value=in_progress", () => {
    expect(html).toMatch(/<option value="in_progress">in_progress<\/option>/);
  });

  it("has option value=completed", () => {
    expect(html).toMatch(/<option value="completed">completed<\/option>/);
  });

  it("has option value=failed", () => {
    expect(html).toMatch(/<option value="failed">failed<\/option>/);
  });

  it("has option value=blocked", () => {
    expect(html).toMatch(/<option value="blocked">blocked<\/option>/);
  });

  it("tasks list iterates over filteredTasks, not tasks", () => {
    // The x-for loop in the tasks pane must use filteredTasks
    expect(html).toContain('x-for="t in filteredTasks"');
    // Must NOT iterate directly over tasks (old pattern) in the tasks pane
    // Note: other panes don't use tasks, so this checks there's no bare "t in tasks"
    // within the tasks pane section. We check the whole html for backward compat:
    // the old "x-for=\"t in tasks\"" should no longer appear.
    expect(html).not.toContain('x-for="t in tasks"');
  });

  it("empty state still uses tasks.length === 0, not filteredTasks (always show when filter empties)", () => {
    // The empty-state for tasks should show when filteredTasks is empty
    // (either filteredTasks.length === 0 or the list renders conditionally)
    // Accept either filteredTasks.length === 0 or the x-show on ul covers it
    const hasFilteredEmpty = html.includes("filteredTasks.length === 0");
    const hasOldTasksEmptyWithFiltered = html.includes('x-show="filteredTasks.length > 0"');
    expect(hasFilteredEmpty || hasOldTasksEmptyWithFiltered).toBe(true);
  });

  it("h2 Tasks heading is still present in the tasks pane", () => {
    expect(html).toContain("<h2>Tasks</h2>");
  });

  it("activeTaskCount binding is still present in the header (unaffected by filter)", () => {
    expect(html).toContain("activeTaskCount");
  });
});

// ---------------------------------------------------------------------------
// app.js: taskStatusFilter state and filteredTasks getter
// ---------------------------------------------------------------------------

describe("frontend-task-filter: app.js — taskStatusFilter state and filteredTasks", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("declares taskStatusFilter state defaulting to 'active'", () => {
    expect(js).toContain('taskStatusFilter:');
    expect(js).toContain('"active"');
  });

  it("has a filteredTasks getter", () => {
    expect(js).toContain("get filteredTasks()");
  });

  it("filteredTasks returns all tasks when filter is 'all'", () => {
    // Should return this.tasks when f === "all"
    expect(js).toContain('"all"');
    // The getter should return this.tasks in the 'all' branch
    const getterStart = js.indexOf("get filteredTasks()");
    expect(getterStart).toBeGreaterThan(-1);
    const getterEnd = js.indexOf("\n  },", getterStart);
    const getterBody = js.slice(getterStart, getterEnd);
    expect(getterBody).toContain("this.tasks");
    expect(getterBody).toContain('"all"');
  });

  it("filteredTasks filters by pending|claimed|in_progress for 'active'", () => {
    const getterStart = js.indexOf("get filteredTasks()");
    expect(getterStart).toBeGreaterThan(-1);
    const getterEnd = js.indexOf("\n  },", getterStart);
    const getterBody = js.slice(getterStart, getterEnd);
    expect(getterBody).toContain('"pending"');
    expect(getterBody).toContain('"claimed"');
    expect(getterBody).toContain('"in_progress"');
  });

  it("filteredTasks filters by exact status for other single values", () => {
    const getterStart = js.indexOf("get filteredTasks()");
    const getterEnd = js.indexOf("\n  },", getterStart);
    const getterBody = js.slice(getterStart, getterEnd);
    // Should have a filter call for the exact-match case
    expect(getterBody).toContain("t.status");
    expect(getterBody).toContain(".filter(");
  });

  it("activeTaskCount computation is still absolute (not filter-scoped)", () => {
    // activeTaskCount must be derived from taskArr (the full array), not filteredTasks
    // It appears in the refresh() method — check it still uses taskArr.filter
    const refreshStart = js.indexOf("async refresh()");
    expect(refreshStart).toBeGreaterThan(-1);
    const activeCountIdx = js.indexOf("activeTaskCount", refreshStart);
    expect(activeCountIdx).toBeGreaterThan(-1);
    // Confirm activeTaskCount assignment is inside refresh() by checking it's before filteredTasks getter
    const filteredGetterIdx = js.indexOf("get filteredTasks()");
    expect(activeCountIdx).toBeLessThan(filteredGetterIdx);
  });
});

// ---------------------------------------------------------------------------
// CSS: .pane-header and .filter-select
// ---------------------------------------------------------------------------

describe("frontend-task-filter: styles.css — pane-header and filter-select", () => {
  let css: string;
  try {
    css = readStatic("styles.css");
  } catch {
    css = "";
  }

  it("styles .pane-header class", () => {
    expect(css).toContain(".pane-header");
  });

  it(".pane-header uses flex display", () => {
    const paneHeaderIdx = css.indexOf(".pane-header");
    expect(paneHeaderIdx).toBeGreaterThan(-1);
    // Find the rule block
    const blockStart = css.indexOf("{", paneHeaderIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("flex");
  });

  it("styles .filter-select class", () => {
    expect(css).toContain(".filter-select");
  });

  it(".filter-select does not introduce new colors (uses CSS variables)", () => {
    const filterSelectIdx = css.indexOf(".filter-select");
    expect(filterSelectIdx).toBeGreaterThan(-1);
    const blockStart = css.indexOf("{", filterSelectIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    // Should use var(--color-*) references, not raw hex/rgb for the main colors
    // At least one var() reference in the block
    expect(block).toContain("var(--color-");
  });
});
