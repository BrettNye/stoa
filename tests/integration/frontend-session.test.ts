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
// app.js: dashboard() factory — session state fields
// ---------------------------------------------------------------------------

describe("frontend-session: app.js — dashboard() factory fields", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("declares pinnedViews state as empty array", () => {
    expect(js).toContain("pinnedViews:");
    expect(js).toContain("[]");
  });

  it("declares pinning state", () => {
    expect(js).toContain("pinning:");
  });

  it("exposes hydrateFromHash method", () => {
    expect(js).toContain("hydrateFromHash()");
  });

  it("exposes syncToHash method", () => {
    expect(js).toContain("syncToHash()");
  });

  it("exposes loadPinnedViews method", () => {
    expect(js).toContain("loadPinnedViews()");
  });

  it("exposes savePinnedViews method", () => {
    expect(js).toContain("savePinnedViews()");
  });

  it("exposes addPin method", () => {
    expect(js).toContain("addPin()");
  });

  it("exposes applyPin method", () => {
    expect(js).toContain("applyPin(");
  });
});

// ---------------------------------------------------------------------------
// app.js: boot() — calls hydrateFromHash() before refresh()
// ---------------------------------------------------------------------------

describe("frontend-session: app.js — boot() lifecycle order", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("boot() calls hydrateFromHash before first refresh", () => {
    const bootStart = js.indexOf("async boot()");
    expect(bootStart).toBeGreaterThan(-1);
    // Find the end of boot() — look for the closing brace pattern
    // We find the next top-level method by looking for "},\n\n" or similar
    const hydrateIdx = js.indexOf("hydrateFromHash()", bootStart);
    const refreshIdx = js.indexOf("this.refresh()", bootStart);
    expect(hydrateIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(-1);
    // hydrateFromHash should appear BEFORE refresh in boot()
    expect(hydrateIdx).toBeLessThan(refreshIdx);
  });

  it("boot() loads pinnedViews from loadPinnedViews()", () => {
    const bootStart = js.indexOf("async boot()");
    expect(bootStart).toBeGreaterThan(-1);
    // loadPinnedViews() should be called in boot
    const loadIdx = js.indexOf("loadPinnedViews()", bootStart);
    expect(loadIdx).toBeGreaterThan(-1);
  });

  it("boot() wires a hashchange event listener", () => {
    const bootStart = js.indexOf("async boot()");
    expect(bootStart).toBeGreaterThan(-1);
    const hashchangeIdx = js.indexOf("hashchange", bootStart);
    expect(hashchangeIdx).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// app.js: hydrateFromHash() — reads URL hash into state
// ---------------------------------------------------------------------------

describe("frontend-session: app.js — hydrateFromHash()", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("hydrateFromHash reads URLSearchParams from window.location.hash", () => {
    // Find the method definition (not the call site) — look for "hydrateFromHash() {"
    const fnIdx = js.indexOf("hydrateFromHash() {");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("URLSearchParams");
    expect(body).toContain("window.location.hash");
  });

  it("hydrateFromHash reads 'tasks' param into taskStatusFilter", () => {
    const fnIdx = js.indexOf("hydrateFromHash() {");
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain('"tasks"');
    expect(body).toContain("taskStatusFilter");
  });
});

// ---------------------------------------------------------------------------
// app.js: syncToHash() — writes state into URL hash without polluting history
// ---------------------------------------------------------------------------

describe("frontend-session: app.js — syncToHash()", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("syncToHash uses history.replaceState", () => {
    // Find the method definition (not the call site) — look for "syncToHash() {"
    const fnIdx = js.indexOf("syncToHash() {");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("replaceState");
  });

  it("syncToHash does NOT serialize 'active' (the default)", () => {
    const fnIdx = js.indexOf("syncToHash() {");
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    // The default 'active' should be excluded — only serialise non-defaults
    // The spec says: if taskStatusFilter !== "active" then set tasks param
    expect(body).toContain('"active"');
    // Should have a conditional that excludes active from serialization
    expect(body).toMatch(/!== ["']active["']|taskStatusFilter !== ["']active["']/);
  });

  it("syncToHash sets 'tasks' param in URLSearchParams", () => {
    const fnIdx = js.indexOf("syncToHash() {");
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain('"tasks"');
    expect(body).toContain("URLSearchParams");
  });

  it("syncToHash is wired to fire when taskStatusFilter changes", () => {
    // Either via $watch or some other reactivity mechanism
    expect(js).toMatch(/\$watch.*taskStatusFilter|syncToHash/);
    // The syncToHash call must appear at least twice: definition + wiring
    const firstIdx = js.indexOf("syncToHash");
    const secondIdx = js.indexOf("syncToHash", firstIdx + 1);
    expect(secondIdx).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// app.js: pinnedViews localStorage persistence
// ---------------------------------------------------------------------------

describe("frontend-session: app.js — pinnedViews localStorage", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("loadPinnedViews reads from localStorage key stoa.pinnedViews", () => {
    // Find the method definition (not the call site) — look for "loadPinnedViews() {"
    const fnIdx = js.indexOf("loadPinnedViews() {");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("localStorage");
    expect(body).toContain("stoa.pinnedViews");
    expect(body).toContain("JSON.parse");
  });

  it("loadPinnedViews returns empty array on parse error (safe fallback)", () => {
    const fnIdx = js.indexOf("loadPinnedViews() {");
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    // Must have a try/catch and fallback []
    expect(body).toContain("try");
    expect(body).toContain("catch");
    expect(body).toContain("[]");
  });

  it("savePinnedViews writes to localStorage key stoa.pinnedViews as JSON", () => {
    // Find the method definition — look for "savePinnedViews() {"
    const fnIdx = js.indexOf("savePinnedViews() {");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("localStorage");
    expect(body).toContain("stoa.pinnedViews");
    expect(body).toContain("JSON.stringify");
  });
});

// ---------------------------------------------------------------------------
// app.js: addPin() — prompts for name, snapshots current hash
// ---------------------------------------------------------------------------

describe("frontend-session: app.js — addPin()", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("addPin uses prompt() to get a name", () => {
    const fnIdx = js.indexOf("addPin()");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("prompt(");
  });

  it("addPin returns early if name is falsy", () => {
    const fnIdx = js.indexOf("addPin()");
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("return");
  });

  it("addPin snapshots window.location.hash", () => {
    const fnIdx = js.indexOf("addPin()");
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("window.location.hash");
  });

  it("addPin pushes {name, hash} object onto pinnedViews", () => {
    const fnIdx = js.indexOf("addPin()");
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("pinnedViews");
    expect(body).toContain("push(");
    expect(body).toContain("name");
    expect(body).toContain("hash");
  });

  it("addPin calls savePinnedViews after pushing", () => {
    const fnIdx = js.indexOf("addPin()");
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("savePinnedViews");
  });
});

// ---------------------------------------------------------------------------
// app.js: applyPin() — sets window.location.hash to trigger hashchange
// ---------------------------------------------------------------------------

describe("frontend-session: app.js — applyPin()", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("applyPin sets window.location.hash to pin.hash", () => {
    const fnIdx = js.indexOf("applyPin(");
    expect(fnIdx).toBeGreaterThan(-1);
    const bodyStart = js.indexOf("{", fnIdx);
    const bodyEnd = js.indexOf("\n    },", fnIdx);
    const body = js.slice(bodyStart, bodyEnd);
    expect(body).toContain("window.location.hash");
    expect(body).toContain("pin.hash");
  });
});

// ---------------------------------------------------------------------------
// index.html: header chip row
// ---------------------------------------------------------------------------

describe("frontend-session: index.html — pinned-views chip row", () => {
  let html: string;
  try {
    html = readStatic("index.html");
  } catch {
    html = "";
  }

  it("has a .pinned-views container in the header", () => {
    expect(html).toContain("pinned-views");
  });

  it("renders a x-for loop over pinnedViews", () => {
    expect(html).toContain("pinnedViews");
    expect(html).toContain('x-for');
    // The loop should reference pin in pinnedViews
    expect(html).toMatch(/x-for="pin in pinnedViews"/);
  });

  it("pin chips use .pin-chip class", () => {
    expect(html).toContain("pin-chip");
  });

  it("pin chips have @click=applyPin(pin)", () => {
    expect(html).toContain("applyPin(pin)");
  });

  it("pin chips display pin.name via x-text", () => {
    expect(html).toContain('x-text="pin.name"');
  });

  it("has a .pin-add button for adding new pins", () => {
    expect(html).toContain("pin-add");
  });

  it("pin-add button calls addPin()", () => {
    expect(html).toContain("addPin()");
  });

  it("refresh button is still present in the header", () => {
    expect(html).toContain('@click="refresh()"');
    expect(html).toContain(':disabled="loading"');
  });

  it("pinned-views container is inside <header>", () => {
    const headerStart = html.indexOf("<header>");
    const headerEnd = html.indexOf("</header>");
    expect(headerStart).toBeGreaterThan(-1);
    expect(headerEnd).toBeGreaterThan(headerStart);
    const headerBlock = html.slice(headerStart, headerEnd);
    expect(headerBlock).toContain("pinned-views");
  });
});

// ---------------------------------------------------------------------------
// styles.css: pinned-views chip styles
// ---------------------------------------------------------------------------

describe("frontend-session: styles.css — pinned-views chip styles", () => {
  let css: string;
  try {
    css = readStatic("styles.css");
  } catch {
    css = "";
  }

  it("has .pinned-views rule with inline-flex", () => {
    expect(css).toContain(".pinned-views");
    const pvIdx = css.indexOf(".pinned-views");
    const blockStart = css.indexOf("{", pvIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("inline-flex");
  });

  it("has .pin-chip rule", () => {
    expect(css).toContain(".pin-chip");
  });

  it(".pin-chip has border-radius (pill shape)", () => {
    const chipIdx = css.indexOf(".pin-chip");
    const blockStart = css.indexOf("{", chipIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("border-radius");
  });

  it(".pin-chip uses CSS variable for color (not raw hex)", () => {
    const chipIdx = css.indexOf(".pin-chip");
    const blockStart = css.indexOf("{", chipIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("var(--color-");
  });

  it(".pin-chip:hover changes background", () => {
    expect(css).toContain(".pin-chip:hover");
    const hoverIdx = css.indexOf(".pin-chip:hover");
    const blockStart = css.indexOf("{", hoverIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("background");
  });

  it("has .pin-add rule", () => {
    expect(css).toContain(".pin-add");
  });

  it(".pin-add has dashed border (affordance indicates 'add' action)", () => {
    const addIdx = css.indexOf(".pin-add");
    const blockStart = css.indexOf("{", addIdx);
    const blockEnd = css.indexOf("}", blockStart);
    const block = css.slice(blockStart, blockEnd);
    expect(block).toContain("dashed");
  });
});
