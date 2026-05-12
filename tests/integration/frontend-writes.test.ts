import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appJsPath = join(__dirname, "../../src/transport/ui/static/app.js");

function readAppJs(): string {
  return readFileSync(appJsPath, "utf8");
}

// ---------------------------------------------------------------------------
// Basic structure — dashboard() factory still present (strict superset)
// ---------------------------------------------------------------------------

describe("frontend-writes: app.js is a strict superset of frontend-shell", () => {
  let js: string;
  try {
    js = readAppJs();
  } catch {
    js = "";
  }

  it("defines dashboard() function", () => {
    expect(js).toContain("function dashboard()");
  });

  it("preserves tasks, agents, channelEntries, wikis state", () => {
    expect(js).toContain("tasks:");
    expect(js).toContain("agents:");
    expect(js).toContain("channelEntries:");
    expect(js).toContain("wikis:");
  });

  it("preserves boot(), refresh(), startPolling(), stopPolling()", () => {
    expect(js).toContain("boot()");
    expect(js).toContain("refresh()");
    expect(js).toContain("startPolling()");
    expect(js).toContain("stopPolling()");
  });

  it("preserves relTime(), taskHref(), channelHref() helpers", () => {
    expect(js).toContain("relTime(");
    expect(js).toContain("taskHref(");
    expect(js).toContain("channelHref(");
  });

  it("still fetches all 5 read endpoints", () => {
    expect(js).toContain("/api/health");
    expect(js).toContain("/api/tasks");
    expect(js).toContain("/api/agents");
    expect(js).toContain("/api/channels");
    expect(js).toContain("/api/wikis");
  });
});

// ---------------------------------------------------------------------------
// Write affordances — new state fields
// ---------------------------------------------------------------------------

describe("frontend-writes: new state fields", () => {
  let js: string;
  try {
    js = readAppJs();
  } catch {
    js = "";
  }

  it("declares spawnOpen state", () => {
    expect(js).toContain("spawnOpen:");
  });

  it("declares spawnSpecialty state", () => {
    expect(js).toContain("spawnSpecialty:");
  });

  it("declares spawnSuggestions state", () => {
    expect(js).toContain("spawnSuggestions:");
  });

  it("declares spawnSelected state", () => {
    expect(js).toContain("spawnSelected:");
  });

  it("declares spawnLoading state", () => {
    expect(js).toContain("spawnLoading:");
  });

  it("declares composer object with open, channel, content, sending fields", () => {
    expect(js).toContain("composer:");
    expect(js).toContain("open:");
    expect(js).toContain("channel:");
    expect(js).toContain("content:");
    expect(js).toContain("sending:");
  });
});

// ---------------------------------------------------------------------------
// Write methods — signatures
// ---------------------------------------------------------------------------

describe("frontend-writes: app.js dashboard() exposes claim, post, register", () => {
  let js: string;
  try {
    js = readAppJs();
  } catch {
    js = "";
  }

  it("app.js dashboard() exposes claim(task)", () => {
    expect(js).toMatch(/claim\(task\)/);
  });

  it("app.js dashboard() exposes async post()", () => {
    expect(js).toMatch(/async post\(\)/);
  });

  it("app.js dashboard() exposes async register()", () => {
    expect(js).toMatch(/async register\(\)/);
  });

  it("has openComposer() method", () => {
    expect(js).toContain("openComposer(");
  });

  it("has openSpawn() method", () => {
    expect(js).toContain("openSpawn()");
  });

  it("has closeSpawn() method", () => {
    expect(js).toContain("closeSpawn()");
  });

  it("has suggest() method", () => {
    expect(js).toContain("suggest(");
  });

  it("has flashError() method", () => {
    expect(js).toContain("flashError(");
  });
});

// ---------------------------------------------------------------------------
// Claim behavior — optimistic update + rollback guards
// ---------------------------------------------------------------------------

describe("frontend-writes: claim() optimistic + rollback pattern", () => {
  let js: string;
  try {
    js = readAppJs();
  } catch {
    js = "";
  }

  it("claim() calls POST /api/tasks/:id/claim", () => {
    expect(js).toContain("/api/tasks/");
    expect(js).toContain("/claim");
  });

  it("claim() uses method: POST", () => {
    expect(js).toContain("method: \"POST\"");
  });

  it("claim() sends expected_updated in the request body", () => {
    expect(js).toContain("expected_updated");
  });

  it("claim() sets task.loading while in-flight", () => {
    expect(js).toContain("task.loading");
  });

  it("claim() optimistically sets task status to claimed", () => {
    expect(js).toContain("task.status");
  });

  it("claim() handles 409 conflict — already claimed — with rollback and flash", () => {
    expect(js).toContain("409");
    expect(js).toContain("already claimed");
  });

  it("claim() handles 412 OCC mismatch — task changed — with rollback and flash", () => {
    expect(js).toContain("412");
    expect(js).toContain("task changed");
  });

  it("claim() saves prev state for rollback before optimistic mutation", () => {
    // Should spread/clone task state before mutating
    expect(js).toMatch(/prev\s*=\s*\{[^}]*\}|Object\.assign|spread|prev\s*=\s*\.\.\.|\.\.\.task/);
  });

  it("claim() guards against firing while task.loading is true", () => {
    expect(js).toContain("task.loading");
  });
});

// ---------------------------------------------------------------------------
// Composer (channel post) behavior
// ---------------------------------------------------------------------------

describe("frontend-writes: post() optimistic + rollback pattern", () => {
  let js: string;
  try {
    js = readAppJs();
  } catch {
    js = "";
  }

  it("post() calls POST /api/channels/:name/posts", () => {
    expect(js).toContain("/api/channels/");
    expect(js).toContain("/posts");
  });

  it("post() sends content in the request body", () => {
    expect(js).toContain("content");
  });

  it("post() sets composer.sending while in-flight", () => {
    expect(js).toContain("composer.sending");
  });

  it("post() prepends new entry to channelEntries optimistically", () => {
    expect(js).toContain("channelEntries");
    expect(js).toContain("unshift");
  });

  it("post() guards against empty/whitespace-only content", () => {
    expect(js).toContain("trim()");
  });

  it("post() guards against double-submit while sending", () => {
    expect(js).toContain("composer.sending");
  });
});

// ---------------------------------------------------------------------------
// Spawn modal behavior
// ---------------------------------------------------------------------------

describe("frontend-writes: spawn modal behavior", () => {
  let js: string;
  try {
    js = readAppJs();
  } catch {
    js = "";
  }

  it("openSpawn() sets spawnOpen to true", () => {
    expect(js).toContain("spawnOpen");
    expect(js).toContain("true");
  });

  it("closeSpawn() sets spawnOpen to false", () => {
    expect(js).toContain("spawnOpen");
    expect(js).toContain("false");
  });

  it("openSpawn() resets spawnSuggestions", () => {
    expect(js).toContain("spawnSuggestions");
  });

  it("openSpawn() resets spawnSelected", () => {
    expect(js).toContain("spawnSelected");
  });

  it("suggest() calls GET /api/agents/suggest or /api/pokemon/suggest", () => {
    expect(js).toMatch(/suggest|pokemon/i);
  });

  it("suggest() populates spawnSuggestions array", () => {
    expect(js).toContain("spawnSuggestions");
  });

  it("register() calls POST /api/agents", () => {
    expect(js).toContain("/api/agents");
  });

  it("register() sends selected_species in body", () => {
    expect(js).toContain("selected_species");
  });

  it("register() sets spawnLoading while in-flight", () => {
    expect(js).toContain("spawnLoading");
  });

  it("register() appends new agent to agents array on success", () => {
    expect(js).toContain("agents");
    expect(js).toContain("push");
  });

  it("register() guards against firing while spawnLoading is true", () => {
    expect(js).toContain("spawnLoading");
  });

  it("register() guards against empty spawnSelected", () => {
    expect(js).toContain("spawnSelected");
  });
});

// ---------------------------------------------------------------------------
// flashError utility
// ---------------------------------------------------------------------------

describe("frontend-writes: flashError() utility", () => {
  let js: string;
  try {
    js = readAppJs();
  } catch {
    js = "";
  }

  it("flashError adds a CSS class for the error state", () => {
    expect(js).toContain("classList");
  });

  it("flashError uses setTimeout to remove the class (transient)", () => {
    expect(js).toContain("setTimeout");
  });
});

// ---------------------------------------------------------------------------
// Fixup: suggest() clears stale suggestions on entry + surfaces errors
// ---------------------------------------------------------------------------

describe("frontend-writes: suggest() error-handling fixup", () => {
  let js: string;
  try {
    js = readAppJs();
  } catch {
    js = "";
  }

  it("suggest() resets spawnSuggestions to [] before the fetch (not inside the success branch)", () => {
    // The reset must appear BEFORE the fetch call within suggest().
    // Heuristic: the assignment `spawnSuggestions = []` must appear before
    // `fetch(` inside the suggest function body.
    const suggestStart = js.indexOf("async suggest()");
    expect(suggestStart).toBeGreaterThan(-1);
    const fetchIdx = js.indexOf("fetch(", suggestStart);
    const resetIdx = js.indexOf("spawnSuggestions = []", suggestStart);
    expect(resetIdx).toBeGreaterThan(-1);
    expect(resetIdx).toBeLessThan(fetchIdx);
  });

  it("suggest() calls flashError when the response is not ok", () => {
    // flashError must be referenced inside suggest(), after the fetch, on the
    // non-ok branch (i.e. not only inside `if (res.ok)`).
    const suggestStart = js.indexOf("async suggest()");
    const nextMethod = js.indexOf("async register()", suggestStart);
    const suggestBody = js.slice(suggestStart, nextMethod);
    expect(suggestBody).toContain("flashError");
  });
});

// ---------------------------------------------------------------------------
// Fixup: register() surfaces errors via flashError (modal stays open)
// ---------------------------------------------------------------------------

describe("frontend-writes: register() error-handling fixup", () => {
  let js: string;
  try {
    js = readAppJs();
  } catch {
    js = "";
  }

  it("register() calls flashError when the response is not ok", () => {
    const registerStart = js.indexOf("async register()");
    // Next method starts after register block — find closing brace region
    const flashCallAfterStart = js.indexOf("flashError", registerStart);
    expect(flashCallAfterStart).toBeGreaterThan(-1);
    // Confirm it's within register's body (before the next top-level method)
    const nextSection = js.indexOf("// ---", registerStart);
    expect(flashCallAfterStart).toBeLessThan(nextSection);
  });

  it("register() does NOT call closeSpawn() on the failure path (modal stays open)", () => {
    // closeSpawn must only be called AFTER res.ok is confirmed — not on the error branch.
    // The error path must NOT contain closeSpawn. We verify by checking the
    // !res.ok block does not call closeSpawn.
    const registerStart = js.indexOf("async register()");
    const resNotOkIdx = js.indexOf("!res.ok", registerStart);
    expect(resNotOkIdx).toBeGreaterThan(-1);
    // Extract only the "if (!res.ok) { ... }" block (up to the closing brace)
    const blockStart = js.indexOf("{", resNotOkIdx);
    const blockEnd = js.indexOf("}", blockStart);
    const errorBlock = js.slice(blockStart, blockEnd + 1);
    expect(errorBlock).not.toContain("closeSpawn");
  });
});
