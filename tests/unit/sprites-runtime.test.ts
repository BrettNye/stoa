import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";

import {
  renderSprite,
  SpriteRenderError,
  SpriteVariantNotAvailableError,
  type Fetcher
} from "../../src/core/sprites-runtime.js";

// -----------------------------
// PNG fixture helper
// -----------------------------
//
// Builds a 96x96 RGBA PNG with the four-quadrant test pattern:
//   top-left (0..47 x 0..47):     red opaque    (255, 0, 0, 255)
//   top-right (48..95 x 0..47):   green opaque  (0, 255, 0, 255)
//   bottom-left (0..47 x 48..95): blue opaque   (0, 0, 255, 255)
//   bottom-right (48..95 x 48..95): transparent (0, 0, 0, 0)
//
// This pattern exercises every cell-render branch:
//  - both halves opaque cells (anywhere within a quadrant: same color top + bottom)
//  - top opaque / bottom transparent (cells straddling the bottom-right edge from above)
//  - bottom opaque / top transparent (cells straddling the bottom-right edge from left)
//  - both transparent (deep inside bottom-right quadrant)
function makeQuadrantPng(): Buffer {
  const width = 96;
  const height = 96;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const left = x < 48;
      const top = y < 48;
      let r = 0, g = 0, b = 0, a = 255;
      if (top && left) { r = 255; }                       // red
      else if (top && !left) { g = 255; }                 // green
      else if (!top && left) { b = 255; }                 // blue
      else { a = 0; }                                      // transparent
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return PNG.sync.write({ width, height, data });
}

// -----------------------------
// Fetcher factory
// -----------------------------

interface FakeFetcherOptions {
  spriteEntryUrl: string;
  spriteImageUrl: string;
  spriteEntryBody?: unknown;
  spriteImageBytes?: Buffer;
  entryStatus?: number;
  imageStatus?: number;
}

function makeFakeFetcher(opts: FakeFetcherOptions): { fetcher: Fetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: Fetcher = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url === opts.spriteEntryUrl) {
      const status = opts.entryStatus ?? 200;
      if (status !== 200) {
        return new Response("err", { status });
      }
      const body = opts.spriteEntryBody ?? { sprites: { front_default: opts.spriteImageUrl } };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url === opts.spriteImageUrl) {
      const status = opts.imageStatus ?? 200;
      if (status !== 200) {
        return new Response("err", { status });
      }
      const bytes = opts.spriteImageBytes ?? makeQuadrantPng();
      // Return raw bytes; ArrayBuffer with a copy avoids SharedArrayBuffer typing surprises.
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      return new Response(ab as ArrayBuffer, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetcher, calls };
}

// -----------------------------
// Test harness
// -----------------------------

const ENTRY_URL = "https://pokeapi.co/api/v2/pokemon/150";
const IMAGE_URL = "https://example.com/sprites/mewtwo.png";

describe("sprites-runtime — renderSprite", () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = mkdtempSync(join(tmpdir(), "sprites-"));
  });

  afterEach(() => {
    rmSync(vaultPath, { recursive: true, force: true });
  });

  // -- 1. Hand-authored precedence
  it("returns hand-authored sprite when cache file lacks the rendered sentinel", async () => {
    const dir = join(vaultPath, "_index", "sprites");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "foo.txt"), "some\nascii\nart\n");

    const spy = vi.fn();
    const fetcher: Fetcher = async (...args) => { spy(...args); return new Response("", { status: 500 }); };

    const out = await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "foo",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher
    });

    expect(out.source).toBe("hand-authored");
    expect(out.ascii_lines).toEqual(["some", "ascii", "art"]);
    expect(spy).not.toHaveBeenCalled();
    expect(out.cache_path).toBe(join(vaultPath, "_index", "sprites", "foo.txt"));
  });

  // -- 2. Cache hit (rendered sentinel present)
  it("returns cached rendered sprite when the sentinel header is present", async () => {
    const dir = join(vaultPath, "_index", "sprites");
    mkdirSync(dir, { recursive: true });
    const sentinelLine = "# rendered: 2026-04-30T00:00:00.000Z mode=truecolor";
    const lines = Array.from({ length: 8 }, (_, i) => `line${i}`);
    writeFileSync(join(dir, "mewtwo.txt"), [sentinelLine, ...lines].join("\n") + "\n");

    const spy = vi.fn();
    const fetcher: Fetcher = async (...args) => { spy(...args); return new Response("", { status: 500 }); };

    const out = await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "mewtwo",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher
    });

    expect(out.source).toBe("cached");
    expect(out.ascii_lines).toEqual(lines);
    expect(spy).not.toHaveBeenCalled();
  });

  // -- 3. Cache miss → render (truecolor)
  it("renders to truecolor and writes a cache file with the rendered sentinel", async () => {
    const { fetcher, calls } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL
    });

    const out = await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "mewtwo",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher
    });

    expect(calls.length).toBe(2);
    expect(calls[0]).toBe(ENTRY_URL);
    expect(calls[1]).toBe(IMAGE_URL);
    expect(out.source).toBe("rendered");
    expect(out.ascii_lines.length).toBe(8);
    expect(out.cache_path).toBe(join(vaultPath, "_index", "sprites", "mewtwo.txt"));
    expect(existsSync(out.cache_path)).toBe(true);

    const fileText = readFileSync(out.cache_path, "utf8");
    const firstLine = fileText.split("\n")[0];
    expect(firstLine).toMatch(/^# rendered: \S+ mode=truecolor$/);
    // Body must contain truecolor escape codes
    expect(fileText).toContain("\x1b[38;2;");
  });

  // -- 4. Variant routing — front_shiny uses suffixed cache path
  it("routes non-default variants to suffixed cache paths", async () => {
    const variantUrl = "https://example.com/sprites/mewtwo-shiny.png";
    const { fetcher, calls } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: variantUrl,
      spriteEntryBody: {
        sprites: {
          front_default: IMAGE_URL,
          front_shiny: variantUrl
        }
      }
    });

    const out = await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "mewtwo",
      spriteVariant: "front_shiny",
      colorMode: "truecolor",
      vaultPath,
      fetcher
    });

    expect(out.source).toBe("rendered");
    expect(out.cache_path).toBe(join(vaultPath, "_index", "sprites", "mewtwo-front_shiny.txt"));
    expect(existsSync(out.cache_path)).toBe(true);
    expect(existsSync(join(vaultPath, "_index", "sprites", "mewtwo.txt"))).toBe(false);
    expect(calls).toContain(variantUrl);
  });

  // -- 5. Variant not available → typed error, no cache file
  it("throws SpriteVariantNotAvailableError when variant is null in the entry, with no cache file", async () => {
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL,
      spriteEntryBody: {
        sprites: {
          front_default: IMAGE_URL,
          front_female: null
        }
      }
    });

    let caught: unknown;
    try {
      await renderSprite({
        pokeapiUrl: ENTRY_URL,
        bareSpriteName: "mewtwo",
        spriteVariant: "front_female",
        colorMode: "truecolor",
        vaultPath,
        fetcher
      });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(SpriteVariantNotAvailableError);
    expect(caught).toBeInstanceOf(SpriteRenderError);
    expect((caught as Error).name).toBe("SpriteVariantNotAvailableError");
    expect(existsSync(join(vaultPath, "_index", "sprites", "mewtwo-front_female.txt"))).toBe(false);
  });

  // -- 6. ColorMode 'ansi' uses 16-color palette escapes, not truecolor
  it("uses 16-color ANSI escapes (not truecolor) when colorMode is 'ansi'", async () => {
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL
    });

    await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "mewtwo",
      spriteVariant: "front_default",
      colorMode: "ansi",
      vaultPath,
      fetcher
    });

    const fileText = readFileSync(join(vaultPath, "_index", "sprites", "mewtwo.txt"), "utf8");
    // No truecolor escape
    expect(fileText).not.toContain("\x1b[38;2;");
    // Has at least one 16-color escape (\x1b[3X or \x1b[9X)
    expect(/\x1b\[(3\d|9\d)/.test(fileText)).toBe(true);
  });

  // -- 7. ColorMode 'none' → no escape sequences anywhere in body
  it("emits pure half-block silhouette with no escapes when colorMode is 'none'", async () => {
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL
    });

    await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "mewtwo",
      spriteVariant: "front_default",
      colorMode: "none",
      vaultPath,
      fetcher
    });

    const fileText = readFileSync(join(vaultPath, "_index", "sprites", "mewtwo.txt"), "utf8");
    const sentinelEnd = fileText.indexOf("\n");
    const body = fileText.slice(sentinelEnd + 1);
    expect(body).not.toContain("\x1b[");
  });

  // -- 8. Alpha mask correctness — transparent quadrant becomes spaces in 'none' mode
  it("renders the transparent quadrant as spaces in colorMode 'none'", async () => {
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL
    });

    const out = await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "mewtwo",
      spriteVariant: "front_default",
      colorMode: "none",
      vaultPath,
      fetcher
    });

    // 96x96 → pxPerCellX = 3, pxPerCellHalfY = 6 (2 halves = 12 px tall row).
    // Transparent quadrant is x>=48, y>=48. That maps to:
    //   col >= 48/3 = 16   AND   row >= 48/12 = 4
    // So cells in (col 16..31, row 4..7) — both halves entirely inside the
    // transparent quadrant — must be a literal space.
    for (let row = 4; row < 8; row++) {
      for (let col = 16; col < 32; col++) {
        expect(out.ascii_lines[row][col]).toBe(" ");
      }
    }
  });

  // -- 9. Both halves transparent → space (explicit single-cell assertion)
  it("renders a single fully-transparent cell as a space", async () => {
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL
    });

    const out = await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "mewtwo",
      spriteVariant: "front_default",
      colorMode: "none",
      vaultPath,
      fetcher
    });

    // Row 7, col 31 — deep in transparent quadrant
    expect(out.ascii_lines[7][31]).toBe(" ");
  });

  // -- 10. Top opaque, bottom transparent → ▀ with fg only (no bg escape).
  //
  // The PokeAPI 96×96 → 32×16 downsample uses pxPerCellHalfY=6, so the
  // 8-character row grid aligns perfectly to pixel y=48. To test "top half
  // opaque, bottom half transparent within the same cell", build a fixture
  // whose alpha boundary falls inside a cell: pixel rows 0..41 opaque,
  // 42..95 transparent. Body row 3 (y 36..47) then has top-half (y 36..41)
  // opaque and bottom-half (y 42..47) transparent.
  it("emits ▀ with fg-only escape when only the top half is opaque (truecolor)", async () => {
    const width = 96, height = 96;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = 200; data[i + 1] = 50; data[i + 2] = 50;
        data[i + 3] = y < 42 ? 255 : 0;
      }
    }
    const bytes = PNG.sync.write({ width, height, data });
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL,
      spriteImageBytes: bytes
    });

    const out = await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "stripe-top",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher
    });

    const bodyRow3 = out.ascii_lines[3];
    expect(bodyRow3).toContain("▀");
    expect(bodyRow3.includes("\x1b[48;2;")).toBe(false);
    expect(bodyRow3.includes("\x1b[38;2;")).toBe(true);
  });

  // -- 11. Bottom opaque, top transparent → ▄ with fg only
  it("emits ▄ with fg-only escape when only the bottom half is opaque (truecolor)", async () => {
    // Inverse of stripe-mid: rows 0..41 transparent, rows 42..95 opaque.
    // Body row 3 covers y 36..47:
    //   top half = y 36..41 (transparent)
    //   bottom half = y 42..47 (opaque)
    const width = 96, height = 96;
    const data = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        data[i] = 50; data[i + 1] = 50; data[i + 2] = 200;
        data[i + 3] = y >= 42 ? 255 : 0;
      }
    }
    const bytes = PNG.sync.write({ width, height, data });
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL,
      spriteImageBytes: bytes
    });

    const out = await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "stripe-mid-inv",
      spriteVariant: "front_default",
      colorMode: "truecolor",
      vaultPath,
      fetcher
    });

    const bodyRow3 = out.ascii_lines[3];
    expect(bodyRow3).toContain("▄");
    expect(bodyRow3.includes("\x1b[48;2;")).toBe(false);
    expect(bodyRow3.includes("\x1b[38;2;")).toBe(true);
  });

  // -- 12. Output shape: in 'none' mode every line is exactly 32 chars
  it("produces 8 lines of exactly 32 visible chars each in colorMode 'none'", async () => {
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL
    });

    const out = await renderSprite({
      pokeapiUrl: ENTRY_URL,
      bareSpriteName: "mewtwo",
      spriteVariant: "front_default",
      colorMode: "none",
      vaultPath,
      fetcher
    });

    expect(out.ascii_lines.length).toBe(8);
    for (const line of out.ascii_lines) {
      // Count code points, not UTF-16 units, since ▀ is BMP but split-safe.
      // Length in JS string units works because all the chars we emit
      // (space, ▀, ▄, █) are BMP single-unit characters.
      expect(line.length).toBe(32);
    }
  });

  // -- 13. Fetcher failure on entry → SpriteRenderError, no cache file
  it("throws SpriteRenderError when the PokeAPI entry fetch fails (no cache file written)", async () => {
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL,
      entryStatus: 500
    });

    let caught: unknown;
    try {
      await renderSprite({
        pokeapiUrl: ENTRY_URL,
        bareSpriteName: "mewtwo",
        spriteVariant: "front_default",
        colorMode: "truecolor",
        vaultPath,
        fetcher
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SpriteRenderError);
    expect(existsSync(join(vaultPath, "_index", "sprites", "mewtwo.txt"))).toBe(false);
  });

  // -- 14. Fetcher failure on PNG → SpriteRenderError, no cache file
  it("throws SpriteRenderError when the PNG fetch fails (no cache file written)", async () => {
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL,
      imageStatus: 500
    });

    let caught: unknown;
    try {
      await renderSprite({
        pokeapiUrl: ENTRY_URL,
        bareSpriteName: "mewtwo",
        spriteVariant: "front_default",
        colorMode: "truecolor",
        vaultPath,
        fetcher
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SpriteRenderError);
    expect(existsSync(join(vaultPath, "_index", "sprites", "mewtwo.txt"))).toBe(false);
  });

  // -- 15. Decode failure on garbage PNG bytes → SpriteRenderError, no cache file
  it("throws SpriteRenderError when PNG bytes are garbage (no cache file written)", async () => {
    const { fetcher } = makeFakeFetcher({
      spriteEntryUrl: ENTRY_URL,
      spriteImageUrl: IMAGE_URL,
      spriteImageBytes: Buffer.from("not a png")
    });

    let caught: unknown;
    try {
      await renderSprite({
        pokeapiUrl: ENTRY_URL,
        bareSpriteName: "mewtwo",
        spriteVariant: "front_default",
        colorMode: "truecolor",
        vaultPath,
        fetcher
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SpriteRenderError);
    expect(existsSync(join(vaultPath, "_index", "sprites", "mewtwo.txt"))).toBe(false);
  });
});
