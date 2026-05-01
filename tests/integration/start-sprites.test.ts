import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Buffer } from "node:buffer";
import { PNG } from "pngjs";

import { startTool } from "../../src/tools/start.js";
import * as displayConfig from "../../src/core/display-config.js";

// ---------------------------------------------------------------------------
// PNG fixture — small four-quadrant 96×96 RGBA PNG, mirroring the helper used
// by sprites-runtime.test.ts. Inlined to keep the test file self-contained.
// ---------------------------------------------------------------------------

function makeQuadrantPng(): Buffer {
  const width = 96, height = 96;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const left = x < 48;
      const top = y < 48;
      let r = 0, g = 0, b = 0, a = 255;
      if (top && left) { r = 255; }
      else if (top && !left) { g = 255; }
      else if (!top && left) { b = 255; }
      else { a = 0; }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return PNG.sync.write({ width, height, data });
}

// ---------------------------------------------------------------------------
// Fetcher factory — counts sprite-related calls so we can assert "fetcher NOT
// called by sprite render". `start.ts` itself doesn't call ctx.fetcher except
// via renderSprite, so a fetcher that throws on PNG/PokeAPI URLs would be
// equally valid; we use a recorder for clearer assertions.
// ---------------------------------------------------------------------------

interface FakeFetcherOptions {
  pokeapiUrl: string;
  pngUrl: string;
  variantUrls?: Record<string, string | null>;
  pngBytes?: Buffer;
  pngBytesByUrl?: Record<string, Buffer>;
  entryStatus?: number;
  imageStatus?: number;
  throwOnEntry?: boolean;
}

function makeFakeFetcher(opts: FakeFetcherOptions) {
  const calls: string[] = [];
  const fetcher = (async (input: string | URL, _init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url === opts.pokeapiUrl) {
      if (opts.throwOnEntry) {
        throw new Error("network down");
      }
      const status = opts.entryStatus ?? 200;
      if (status !== 200) return new Response("err", { status });
      const sprites: Record<string, string | null> = {
        front_default: opts.pngUrl,
        ...(opts.variantUrls ?? {})
      };
      return new Response(JSON.stringify({ sprites }), { status: 200 });
    }
    // PNG URL match — exact match against pngUrl OR any variantUrls value.
    const pngLookup = opts.pngBytesByUrl?.[url];
    const isKnownPng =
      url === opts.pngUrl ||
      Object.values(opts.variantUrls ?? {}).includes(url);
    if (pngLookup || isKnownPng) {
      const status = opts.imageStatus ?? 200;
      if (status !== 200) return new Response("err", { status });
      const bytes = pngLookup ?? opts.pngBytes ?? makeQuadrantPng();
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return new Response(ab as ArrayBuffer, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

function spriteCalls(calls: string[], pokeapiUrl: string): string[] {
  return calls.filter(u => u === pokeapiUrl || u.includes("sprites/") || u.endsWith(".png"));
}

// ---------------------------------------------------------------------------
// Vault scaffold — minimal alpha + _agents wiki, tunable profile frontmatter.
// ---------------------------------------------------------------------------

function scaffoldVault(): string {
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-int-start-sprites-"));
  mkdirSync(join(vaultPath, "wikis", "alpha"), { recursive: true });
  mkdirSync(join(vaultPath, "wikis", "_agents", "profiles"), { recursive: true });
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  writeFileSync(join(vaultPath, "_index", "aliases.json"), "{}");
  writeFileSync(join(vaultPath, "wikis", "alpha", "map.md"),
    `---
id: map-alpha
type: map
title: alpha
created: 2026-04-29
wiki: alpha
status: active
summary: x
updated: 2026-04-29
---

# alpha map
`);
  return vaultPath;
}

interface ProfileFrontmatter {
  pokeapi_url?: string;
  sprite_variant?: string;
}

function writeProfile(vaultPath: string, name: string, extra: ProfileFrontmatter = {}): void {
  const lines: string[] = [
    "---",
    `id: profile-${name}`,
    "type: profile",
    `title: ${name}`,
    "created: 2026-04-30",
    "wiki: _agents",
    "status: active",
    "summary: test",
    "pokemon_type: psychic",
    "evolution_stage: stage2",
    "moveset: []"
  ];
  if (extra.pokeapi_url) lines.push(`pokeapi_url: ${extra.pokeapi_url}`);
  if (extra.sprite_variant) lines.push(`sprite_variant: ${extra.sprite_variant}`);
  lines.push("---", "", `# ${name}`, "");
  writeFileSync(
    join(vaultPath, "wikis", "_agents", "profiles", `profile-${name}.md`),
    lines.join("\n")
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const POKEAPI_URL = "https://pokeapi.co/api/v2/pokemon/150";
const PNG_URL = "https://example.com/sprites/mewtwo.png";

describe("integration — /start sprite render fallback (T2-1)", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = scaffoldVault();
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // ---- 1. Hand-authored sprite exists → use it; sprite fetcher NOT called.
  it("uses a hand-authored sprite when present and does not call the sprite fetcher", async () => {
    writeProfile(vaultPath, "mewtwo", { pokeapi_url: POKEAPI_URL });
    mkdirSync(join(vaultPath, "_index", "sprites"), { recursive: true });
    writeFileSync(
      join(vaultPath, "_index", "sprites", "mewtwo.txt"),
      "  /\\_/\\\n ( o.o )\n  /tail\n"
    );

    const { fetcher, calls } = makeFakeFetcher({ pokeapiUrl: POKEAPI_URL, pngUrl: PNG_URL });
    const r = await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath, fetcher }
    );

    expect(r.ascii_header).toBeDefined();
    expect(r.ascii_header).toContain("/\\_/\\");
    // The sprite-render path must not have hit the fetcher at all.
    expect(spriteCalls(calls, POKEAPI_URL)).toEqual([]);
  });

  // ---- 2. Hand-authored absent + render succeeds (truecolor)
  it("renders colored ASCII via renderSprite on cache miss and writes the cache file", async () => {
    writeProfile(vaultPath, "mewtwo", { pokeapi_url: POKEAPI_URL });
    const { fetcher } = makeFakeFetcher({ pokeapiUrl: POKEAPI_URL, pngUrl: PNG_URL });

    const r = await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath, fetcher }
    );

    expect(r.ascii_header).toBeDefined();
    // Truecolor escapes propagate into the ascii_header surface.
    expect(r.ascii_header!).toContain("\x1b[38;2;");

    const cachePath = join(vaultPath, "_index", "sprites", "mewtwo.txt");
    expect(existsSync(cachePath)).toBe(true);
    const fileText = readFileSync(cachePath, "utf8");
    expect(fileText.split("\n")[0]).toMatch(/^# rendered: \S+ mode=truecolor$/);
  });

  // ---- 3. Variant routing — front_shiny → suffixed cache path
  it("routes sprite_variant: front_shiny to a -front_shiny.txt cache path", async () => {
    const shinyUrl = "https://example.com/sprites/mewtwo-shiny.png";
    writeProfile(vaultPath, "mewtwo", {
      pokeapi_url: POKEAPI_URL,
      sprite_variant: "front_shiny"
    });
    const { fetcher, calls } = makeFakeFetcher({
      pokeapiUrl: POKEAPI_URL,
      pngUrl: PNG_URL,
      variantUrls: { front_shiny: shinyUrl }
    });

    await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath, fetcher }
    );

    const variantCache = join(vaultPath, "_index", "sprites", "mewtwo-front_shiny.txt");
    const defaultCache = join(vaultPath, "_index", "sprites", "mewtwo.txt");
    expect(existsSync(variantCache)).toBe(true);
    expect(existsSync(defaultCache)).toBe(false);
    expect(calls).toContain(shinyUrl);
  });

  // ---- 4. Variant fallback — null variant → retry with front_default.
  it("retries with front_default when the requested variant is unavailable", async () => {
    writeProfile(vaultPath, "mewtwo", {
      pokeapi_url: POKEAPI_URL,
      sprite_variant: "front_female"
    });
    const { fetcher } = makeFakeFetcher({
      pokeapiUrl: POKEAPI_URL,
      pngUrl: PNG_URL,
      // PokeAPI entry has front_female: null (unavailable) but front_default present.
      variantUrls: { front_female: null }
    });

    const r = await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath, fetcher }
    );

    expect(r.ascii_header).toBeDefined();
    // The fallback rendered into the default cache path (front_default).
    const defaultCache = join(vaultPath, "_index", "sprites", "mewtwo.txt");
    expect(existsSync(defaultCache)).toBe(true);
    // The variant-suffixed file must NOT have been written (renderer threw before write).
    const variantCache = join(vaultPath, "_index", "sprites", "mewtwo-front_female.txt");
    expect(existsSync(variantCache)).toBe(false);
    // ascii_header carries truecolor render content (default colorMode).
    expect(r.ascii_header!).toContain("\x1b[38;2;");
  });

  // ---- 5. Color mode propagation — readDisplayConfig stub returns "ansi".
  it("propagates display config color_mode='ansi' into the renderer output", async () => {
    writeProfile(vaultPath, "mewtwo", { pokeapi_url: POKEAPI_URL });
    vi.spyOn(displayConfig, "readDisplayConfig").mockReturnValue({
      statusline: { emoji_safe_mode: false },
      sprites: { color_mode: "ansi" }
    });

    const { fetcher } = makeFakeFetcher({ pokeapiUrl: POKEAPI_URL, pngUrl: PNG_URL });
    await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath, fetcher }
    );

    const fileText = readFileSync(join(vaultPath, "_index", "sprites", "mewtwo.txt"), "utf8");
    // 16-color escape only — no truecolor.
    expect(fileText).not.toContain("\x1b[38;2;");
    expect(/\x1b\[(3\d|9\d)/.test(fileText)).toBe(true);
    expect(fileText.split("\n")[0]).toMatch(/^# rendered: \S+ mode=ansi$/);
  });

  // ---- 6. Generic render error → empty sprite block; /start still succeeds.
  it("falls back to no sprite header when renderSprite throws a generic error", async () => {
    writeProfile(vaultPath, "mewtwo", { pokeapi_url: POKEAPI_URL });
    const { fetcher } = makeFakeFetcher({
      pokeapiUrl: POKEAPI_URL,
      pngUrl: PNG_URL,
      throwOnEntry: true
    });

    const r = await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath, fetcher }
    );

    // /start MUST succeed; pokemon_state present.
    expect(r.pokemon_state).toBeDefined();
    expect(r.pokemon_state?.name).toBe("mewtwo");
    // ascii_header is absent (or empty) — generic-error fallback is "no sprite header".
    if (r.ascii_header !== undefined) {
      // If a header was emitted, it must NOT contain rendered escape codes.
      expect(r.ascii_header).not.toContain("\x1b[38;2;");
    }
    // No cache file was written.
    expect(existsSync(join(vaultPath, "_index", "sprites", "mewtwo.txt"))).toBe(false);
  });

  // ---- 7. Cache hit on second call → fetcher NOT invoked.
  it("reads from the rendered cache on a subsequent call without re-fetching", async () => {
    writeProfile(vaultPath, "mewtwo", { pokeapi_url: POKEAPI_URL });

    // First call: warm the cache.
    const first = makeFakeFetcher({ pokeapiUrl: POKEAPI_URL, pngUrl: PNG_URL });
    await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath, fetcher: first.fetcher }
    );
    expect(first.calls.length).toBeGreaterThan(0);

    // Second call: a fetcher that throws if invoked. The cache hit means it
    // is never called for sprite work.
    const guarded = (async () => { throw new Error("fetcher must not be called on cache hit"); }) as typeof fetch;
    const r = await startTool.handler(
      { wiki: "alpha", pokemon: "mewtwo" },
      { vaultPath, fetcher: guarded }
    );

    expect(r.ascii_header).toBeDefined();
    expect(r.ascii_header!).toContain("\x1b[38;2;");
  });
});
