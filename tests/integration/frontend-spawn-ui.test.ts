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
// index.html spawn UI checks
// ---------------------------------------------------------------------------

describe("frontend-spawn-ui: index.html", () => {
  let html: string;
  try {
    html = readStatic("index.html");
  } catch {
    html = "";
  }

  it("has a spawn-trigger button inside #agents-actions", () => {
    // The button must exist somewhere in the file
    expect(html).toContain('class="spawn-trigger"');
    expect(html).toContain('@click="openSpawn()"');
    expect(html).toContain("+ new agent");
  });

  it("spawn-trigger button is inside #agents-actions div", () => {
    const agentsActionsIdx = html.indexOf('id="agents-actions"');
    expect(agentsActionsIdx).toBeGreaterThan(-1);
    const spawnTriggerIdx = html.indexOf('spawn-trigger');
    expect(spawnTriggerIdx).toBeGreaterThan(agentsActionsIdx);
    // spawn-trigger should appear after agents-actions opening tag
    // and before the next closing div (roughly)
    const agentsActionsChunk = html.slice(agentsActionsIdx, agentsActionsIdx + 200);
    expect(agentsActionsChunk).toContain('spawn-trigger');
  });

  it("has a spawn modal element with x-show=\"spawnOpen\"", () => {
    expect(html).toContain('x-show="spawnOpen"');
    expect(html).toContain('class="spawn-modal-backdrop"');
  });

  it("modal backdrop closes on @click.self (closeSpawn)", () => {
    expect(html).toContain('@click.self="closeSpawn()"');
  });

  it("modal has a close button calling closeSpawn()", () => {
    expect(html).toContain('class="spawn-close"');
    expect(html).toContain('@click="closeSpawn()"');
  });

  it("specialty input binds x-model=\"spawnSpecialty\"", () => {
    expect(html).toContain('x-model="spawnSpecialty"');
  });

  it("specialty input Enter key triggers suggest()", () => {
    expect(html).toContain('@keydown.enter="suggest()"');
  });

  it("specialty input is disabled when spawnLoading", () => {
    expect(html).toContain(':disabled="spawnLoading"');
  });

  it("suggest button is disabled when !spawnSpecialty or spawnLoading", () => {
    expect(html).toContain(':disabled="!spawnSpecialty || spawnLoading"');
  });

  it("suggest button shows 'Loading...' span during fetch", () => {
    expect(html).toContain('x-show="spawnLoading"');
    expect(html).toContain('Loading');
  });

  it("suggestion grid renders spawnSuggestions via x-for", () => {
    expect(html).toContain('x-for="s in spawnSuggestions"');
  });

  it("suggestion grid items bind sprite image, name, and type", () => {
    expect(html).toContain(':src="s.spriteUrl"');
    expect(html).toContain('x-text="s.name"');
    expect(html).toContain('x-text="s.pokemon_type"');
  });

  it("clicking a candidate sets spawnSelected", () => {
    expect(html).toContain('@click="spawnSelected = s"');
  });

  it("selected candidate gets .selected class", () => {
    expect(html).toContain('selected: spawnSelected && spawnSelected.name === s.name');
  });

  it("register button calls register() and is disabled when !spawnSelected or spawnLoading", () => {
    expect(html).toContain('@click="register()"');
    expect(html).toContain(':disabled="!spawnSelected || spawnLoading"');
  });

  it("register button shows 'Registering...' span during fetch", () => {
    expect(html).toContain('Registering');
  });

  it("spawn hint shown when no suggestions and not loading", () => {
    expect(html).toContain('spawnSuggestions.length === 0 && !spawnLoading');
  });

  it("modal is a sibling of <main> (not nested inside main)", () => {
    const mainEndIdx = html.lastIndexOf("</main>");
    expect(mainEndIdx).toBeGreaterThan(-1);
    const spawnModalIdx = html.indexOf('spawn-modal-backdrop');
    // spawn-modal-backdrop should appear AFTER </main>
    expect(spawnModalIdx).toBeGreaterThan(mainEndIdx);
  });

  it("modal is inside <body>", () => {
    const bodyEndIdx = html.lastIndexOf("</body>");
    const spawnModalIdx = html.indexOf('spawn-modal-backdrop');
    expect(spawnModalIdx).toBeGreaterThan(-1);
    expect(spawnModalIdx).toBeLessThan(bodyEndIdx);
  });
});

// ---------------------------------------------------------------------------
// styles.css spawn modal checks
// ---------------------------------------------------------------------------

describe("frontend-spawn-ui: styles.css", () => {
  let css: string;
  try {
    css = readStatic("styles.css");
  } catch {
    css = "";
  }

  it("has .spawn-trigger styles", () => {
    expect(css).toContain('.spawn-trigger');
  });

  it("has .spawn-modal-backdrop styles with fixed positioning", () => {
    expect(css).toContain('.spawn-modal-backdrop');
    expect(css).toContain('position: fixed');
  });

  it("has .spawn-modal styles with max-width: 90vw", () => {
    expect(css).toContain('.spawn-modal');
    expect(css).toContain('90vw');
  });

  it("has .spawn-modal styles with max-height: 90vh", () => {
    expect(css).toContain('90vh');
  });

  it("has .spawn-grid styles with grid layout", () => {
    expect(css).toContain('.spawn-grid');
    expect(css).toContain('auto-fill');
  });

  it("has .spawn-candidate styles", () => {
    expect(css).toContain('.spawn-candidate');
  });

  it("selected candidate has .selected styles with scale transform", () => {
    expect(css).toContain('.spawn-candidate.selected');
    expect(css).toContain('scale');
  });

  it("uses existing CSS variables (no new palette)", () => {
    // Should use --color-* variables, not raw hex colors specific to spawn
    expect(css).toContain('var(--color-accent)');
    expect(css).toContain('var(--color-surface)');
    expect(css).toContain('var(--color-border)');
    expect(css).toContain('var(--color-text)');
    expect(css).toContain('var(--color-text-muted)');
    expect(css).toContain('var(--color-bg)');
  });

  it("has z-index for modal backdrop", () => {
    expect(css).toContain('z-index: 100');
  });
});

// ---------------------------------------------------------------------------
// app.js must be UNTOUCHED (checked via static read)
// ---------------------------------------------------------------------------

describe("frontend-spawn-ui: app.js not modified (structural check)", () => {
  let js: string;
  try {
    js = readStatic("app.js");
  } catch {
    js = "";
  }

  it("app.js still has openSpawn() method", () => {
    expect(js).toContain('openSpawn()');
  });

  it("app.js still has closeSpawn() method", () => {
    expect(js).toContain('closeSpawn()');
  });

  it("app.js still has suggest() method", () => {
    expect(js).toContain('suggest()');
  });

  it("app.js still has register() method", () => {
    expect(js).toContain('register()');
  });

  it("app.js still has spawnOpen state", () => {
    expect(js).toContain('spawnOpen');
  });

  it("app.js still has spawnSpecialty state", () => {
    expect(js).toContain('spawnSpecialty');
  });

  it("app.js still has spawnSuggestions state", () => {
    expect(js).toContain('spawnSuggestions');
  });

  it("app.js still has spawnSelected state", () => {
    expect(js).toContain('spawnSelected');
  });

  it("app.js still has spawnLoading state", () => {
    expect(js).toContain('spawnLoading');
  });
});
