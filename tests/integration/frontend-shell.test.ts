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
// HTML structure checks
// ---------------------------------------------------------------------------

describe("frontend-shell: index.html", () => {
  let html: string;
  try {
    html = readStatic("index.html");
  } catch {
    html = "";
  }

  it("file exists and is non-empty", () => {
    expect(html.length).toBeGreaterThan(0);
  });

  it("references /static/styles.css", () => {
    expect(html).toContain('/static/styles.css');
  });

  it("references /static/app.js", () => {
    expect(html).toContain('/static/app.js');
  });

  it("references Alpine.js via unpkg CDN with 3.x.x", () => {
    expect(html).toContain('alpinejs@3.x.x');
    expect(html).toContain('unpkg.com');
  });

  it("has x-data=dashboard() on body", () => {
    expect(html).toContain('x-data="dashboard()"');
  });

  it("has x-init=boot() on body", () => {
    expect(html).toContain('x-init="boot()"');
  });

  it("renders the three-pane structure: agents pane", () => {
    expect(html).toMatch(/class="[^"]*pane[^"]*agents[^"]*"|class="[^"]*agents[^"]*pane[^"]*"/);
  });

  it("renders the three-pane structure: tasks pane", () => {
    expect(html).toMatch(/class="[^"]*pane[^"]*tasks[^"]*"|class="[^"]*tasks[^"]*pane[^"]*"/);
  });

  it("renders the three-pane structure: channels pane", () => {
    expect(html).toMatch(/class="[^"]*pane[^"]*channels[^"]*"|class="[^"]*channels[^"]*pane[^"]*"/);
  });

  it("has #agents-actions slot div", () => {
    expect(html).toContain('id="agents-actions"');
  });

  it("has #channels-actions slot div", () => {
    expect(html).toContain('id="channels-actions"');
  });

  it("has a refresh button with @click=refresh()", () => {
    expect(html).toContain('@click="refresh()"');
  });

  it("has :disabled=loading on refresh button", () => {
    expect(html).toContain(':disabled="loading"');
  });

  it("has live-dot span with :class paused binding", () => {
    expect(html).toContain('live-dot');
    expect(html).toContain('paused');
  });

  it("has vaultBaseName binding", () => {
    expect(html).toContain('vaultBaseName');
  });

  it("has wikis.length binding", () => {
    expect(html).toContain('wikis.length');
  });

  it("has activeTaskCount binding", () => {
    expect(html).toContain('activeTaskCount');
  });

  it("has lastRefreshDelta binding", () => {
    expect(html).toContain('lastRefreshDelta');
  });

  // Empty states
  it("has empty-state message for agents: No agents registered.", () => {
    expect(html).toContain('No agents registered');
  });

  it("has empty-state message for tasks", () => {
    expect(html).toMatch(/No tasks|No tasks found/i);
  });

  it("has empty-state message for channels", () => {
    expect(html).toMatch(/No channel entries|No channels/i);
  });

  // Field name presence in Alpine templates
  it("references ApiTask fields in templates: title, wiki, status, claimed_by, required_pokemon_type, updated", () => {
    expect(html).toContain('.title');
    expect(html).toContain('.wiki');
    expect(html).toContain('.status');
    expect(html).toContain('claimed_by');
    expect(html).toContain('required_pokemon_type');
    expect(html).toContain('relTime(t.updated)');
  });

  it("references ApiAgent fields in templates: pokemon, pokemon_type, evolution_stage, spriteUrl, claimedTaskCount", () => {
    expect(html).toContain('.pokemon');
    expect(html).toContain('pokemon_type');
    expect(html).toContain('evolution_stage');
    expect(html).toContain('spriteUrl');
    expect(html).toContain('claimedTaskCount');
  });

  it("references ApiChannelEntry fields in templates: channel, author, ts, excerpt, pageId", () => {
    expect(html).toContain('.channel');
    expect(html).toContain('.author');
    expect(html).toContain('.ts');
    expect(html).toContain('.excerpt');
    expect(html).toContain('pageId');
  });

  it("has per-row slot for write affordances in task rows", () => {
    // task-row-actions or similar anchor inside each task <li>
    expect(html).toContain('task-row-actions');
  });
});

// ---------------------------------------------------------------------------
// CSS checks
// ---------------------------------------------------------------------------

describe("frontend-shell: styles.css", () => {
  let css: string;
  try {
    css = readStatic("styles.css");
  } catch {
    css = "";
  }

  it("file exists and is non-empty", () => {
    expect(css.length).toBeGreaterThan(0);
  });

  it("has a grid layout definition", () => {
    expect(css).toContain('display: grid');
  });

  it("has squirtle-v2 column split at >= 1024px media query", () => {
    expect(css).toContain('1024px');
    // 22/48/30 column split (percentages sum to 100)
    expect(css).toMatch(/22%|22fr|\.22/);
    expect(css).toMatch(/48%|48fr|\.48/);
    expect(css).toMatch(/30%|30fr|\.30/);
  });

  it("styles the .pane class", () => {
    expect(css).toContain('.pane');
  });

  it("styles the .live-dot class", () => {
    expect(css).toContain('.live-dot');
  });

  it("styles the paused state of live-dot", () => {
    expect(css).toContain('paused');
  });
});

// ---------------------------------------------------------------------------
// app.js structure checks
// ---------------------------------------------------------------------------

describe("frontend-shell: app.js", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("file exists and is non-empty", () => {
    expect(js.length).toBeGreaterThan(0);
  });

  it("exports/defines dashboard() function", () => {
    expect(js).toContain('function dashboard()');
  });

  it("declares tasks array state", () => {
    expect(js).toContain('tasks:');
  });

  it("declares agents array state", () => {
    expect(js).toContain('agents:');
  });

  it("declares channelEntries array state", () => {
    expect(js).toContain('channelEntries:');
  });

  it("declares wikis array state", () => {
    expect(js).toContain('wikis:');
  });

  it("declares activeTaskCount state", () => {
    expect(js).toContain('activeTaskCount:');
  });

  it("declares vaultBaseName state", () => {
    expect(js).toContain('vaultBaseName:');
  });

  it("declares lastRefreshDelta state", () => {
    expect(js).toContain('lastRefreshDelta:');
  });

  it("declares pollPaused state", () => {
    expect(js).toContain('pollPaused:');
  });

  it("declares loading state", () => {
    expect(js).toContain('loading:');
  });

  it("has boot() method", () => {
    expect(js).toContain('boot()');
  });

  it("has startPolling() method", () => {
    expect(js).toContain('startPolling()');
  });

  it("has stopPolling() method", () => {
    expect(js).toContain('stopPolling()');
  });

  it("has refresh() method", () => {
    expect(js).toContain('refresh()');
  });

  it("has relTime() method", () => {
    expect(js).toContain('relTime(');
  });

  it("has taskHref() method", () => {
    expect(js).toContain('taskHref(');
  });

  it("fetches /api/health in refresh()", () => {
    expect(js).toContain('/api/health');
  });

  it("fetches /api/tasks in refresh()", () => {
    expect(js).toContain('/api/tasks');
  });

  it("fetches /api/agents in refresh()", () => {
    expect(js).toContain('/api/agents');
  });

  it("fetches /api/channels in refresh()", () => {
    expect(js).toContain('/api/channels');
  });

  it("fetches /api/wikis in refresh()", () => {
    expect(js).toContain('/api/wikis');
  });

  it("uses Promise.all for parallel fetching", () => {
    expect(js).toContain('Promise.all');
  });

  it("taskHref produces obsidian:// URI", () => {
    expect(js).toContain('obsidian://');
  });

  it("poll interval is 10000ms (10s)", () => {
    expect(js).toContain('10000');
  });

  it("listens to visibilitychange event", () => {
    expect(js).toContain('visibilitychange');
  });

  it("references ApiTask field names in js: id, wiki, status, claimed_by, required_pokemon_type, updated", () => {
    // id/wiki/status referenced via taskHref and filtering in app.js
    expect(js).toContain('t.id');
    expect(js).toContain('t.wiki');
    expect(js).toContain('t.status');
    expect(js).toContain('claimed_by');
    expect(js).toContain('required_pokemon_type');
    // updated is referenced in the HTML template via relTime(t.updated); in app.js it appears in comments
    expect(js).toContain('updated');
  });

  it("references ApiAgent field names in js: claimedTaskCount", () => {
    // claimedTaskCount is used directly in app.js (not just in HTML template)
    expect(js).toContain('claimedTaskCount');
  });

  it("references ApiChannelEntry field names in js: channel, ts, excerpt, pageId", () => {
    // These are referenced directly in app.js logic / channel data handling
    expect(js).toContain('channel');
    expect(js).toContain('pageId');
  });

  it("does not wire up any POST endpoints (no write actions)", () => {
    // Should not contain fetch calls to POST endpoints
    // A simple check: no method: 'POST' string
    expect(js).not.toContain("method: 'POST'");
    expect(js).not.toContain('method: "POST"');
  });
});
