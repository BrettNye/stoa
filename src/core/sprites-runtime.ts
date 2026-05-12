/**
 * core/sprites-runtime — pure JS PNG → ASCII sprite renderer.
 *
 * Renders PokeAPI sprite PNGs to colored half-block ASCII portraits suitable
 * for embedding in `/start` headers and similar terminal-facing surfaces.
 *
 * Layout: 12 lines × 48 character cells. Each cell encodes 2 vertically-stacked
 * pixel halves using the Unicode upper/lower half-block characters (▀, ▄, █).
 * Effective resolution = 48 × 24 colored "pixels" downsampled from 96 × 96
 * source PNGs.
 *
 * Color emission depends on `colorMode`:
 *   - "truecolor"  — `\x1b[38;2;R;G;Bm` foreground + `\x1b[48;2;R;G;Bm` background.
 *   - "ansi"       — quantize to nearest of 16 standard ANSI colors.
 *   - "none"       — pure half-block silhouette, no escape codes.
 *
 * Caching:
 *   - `front_default` → `<vaultPath>/_index/sprites/<bareSpriteName>.txt`
 *     (back-compat with hand-authored cartoons at this path).
 *   - All other variants → `<vaultPath>/_index/sprites/<bareSpriteName>-<variant>.txt`.
 *   - Hand-authored files are detected by the absence of a `# rendered: ` first
 *     line and are NEVER overwritten.
 *   - Renderer-produced files start with a sentinel:
 *       `# rendered: <ISO-now> mode=<colorMode>`
 *     and are reused as the cache. `colorMode` is NOT in the filename — flips
 *     re-render the cache.
 */

import { existsSync, promises as fsp } from "node:fs";
import { join, dirname } from "node:path";
import { Buffer } from "node:buffer";
import { PNG } from "pngjs";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type SpriteVariant =
  | "front_default" | "front_shiny"
  | "front_female"  | "front_shiny_female"
  | "back_default"  | "back_shiny"
  | "back_female"   | "back_shiny_female";

export type ColorMode = "truecolor" | "ansi" | "none";

export type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface SpriteRenderInput {
  pokeapiUrl: string;
  bareSpriteName: string;
  spriteVariant: SpriteVariant;
  colorMode: ColorMode;
  vaultPath: string;
  fetcher: Fetcher;
}

export interface SpriteRenderOutput {
  ascii_lines: string[];
  cache_path: string;
  source: "hand-authored" | "rendered" | "cached";
}

export class SpriteRenderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "SpriteRenderError";
  }
}

export class SpriteVariantNotAvailableError extends SpriteRenderError {
  constructor(variant: SpriteVariant) {
    super(`sprite variant not available: ${variant}`);
    this.name = "SpriteVariantNotAvailableError";
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RENDERED_SENTINEL_RE = /^# rendered: /;
const COLS = 48;
const ROWS = 12;         // 12 character rows = 24 pixel rows after half-block packing
const HALVES_PER_ROW = 2;

// Standard 16-color ANSI palette. Tuple is [R, G, B, offset], where:
//   - offset < 60 → fg escape `\x1b[<30+offset>m`,  bg escape `\x1b[<40+offset>m`.
//   - offset ≥ 60 → fg escape `\x1b[<90+offset-60>m`, bg escape `\x1b[<100+offset-60>m`.
export const ANSI_PALETTE: Array<[number, number, number, number]> = [
  [0,   0,   0,   0],   // black
  [170, 0,   0,   1],   // red
  [0,   170, 0,   2],   // green
  [170, 85,  0,   3],   // yellow (brown-yellow)
  [0,   0,   170, 4],   // blue
  [170, 0,   170, 5],   // magenta
  [0,   170, 170, 6],   // cyan
  [170, 170, 170, 7],   // white (light gray)
  [85,  85,  85,  60],  // bright black (gray)
  [255, 85,  85,  61],  // bright red
  [85,  255, 85,  62],  // bright green
  [255, 255, 85,  63],  // bright yellow
  [85,  85,  255, 64],  // bright blue
  [255, 85,  255, 65],  // bright magenta
  [85,  255, 255, 66],  // bright cyan
  [255, 255, 255, 67],  // bright white
];

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function renderSprite(input: SpriteRenderInput): Promise<SpriteRenderOutput> {
  const cachePath = resolveCachePath(input);

  // Hand-authored / cache-hit short-circuits.
  if (existsSync(cachePath)) {
    let raw: string;
    try {
      raw = await fsp.readFile(cachePath, "utf8");
    } catch (e) {
      throw new SpriteRenderError(`failed to read sprite cache at ${cachePath}`, { cause: e });
    }
    const lines = raw.split("\n");
    // Drop trailing empty lines from the final \n.
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

    if (lines.length > 0 && RENDERED_SENTINEL_RE.test(lines[0])) {
      // Cached rendered output.
      return {
        ascii_lines: lines.slice(1),
        cache_path: cachePath,
        source: "cached"
      };
    }
    // Hand-authored — return as-is.
    return {
      ascii_lines: lines,
      cache_path: cachePath,
      source: "hand-authored"
    };
  }

  // Cache miss → fetch + render.
  const spriteUrl = await fetchSpriteUrl(input);
  const pngBuffer = await fetchPngBytes(spriteUrl, input.fetcher);
  const decoded = decodePng(pngBuffer);
  const asciiLines = renderToAscii(decoded, input.colorMode);

  // Persist cache with sentinel.
  const sentinel = `# rendered: ${new Date().toISOString()} mode=${input.colorMode}`;
  const fileBody = [sentinel, ...asciiLines].join("\n") + "\n";
  try {
    await fsp.mkdir(dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, fileBody, "utf8");
  } catch (e) {
    throw new SpriteRenderError(`failed to write sprite cache at ${cachePath}`, { cause: e });
  }

  return {
    ascii_lines: asciiLines,
    cache_path: cachePath,
    source: "rendered"
  };
}

// ---------------------------------------------------------------------------
// Helpers — path resolution
// ---------------------------------------------------------------------------

function resolveCachePath(input: SpriteRenderInput): string {
  const dir = join(input.vaultPath, "_index", "sprites");
  const filename = input.spriteVariant === "front_default"
    ? `${input.bareSpriteName}.txt`
    : `${input.bareSpriteName}-${input.spriteVariant}.txt`;
  return join(dir, filename);
}

// ---------------------------------------------------------------------------
// Helpers — fetching
// ---------------------------------------------------------------------------

async function fetchSpriteUrl(input: {
  pokeapiUrl: string;
  spriteVariant: SpriteVariant;
  fetcher: Fetcher;
}): Promise<string> {
  let response: Response;
  try {
    response = await input.fetcher(input.pokeapiUrl);
  } catch (e) {
    throw new SpriteRenderError(`failed to fetch PokeAPI entry at ${input.pokeapiUrl}`, { cause: e });
  }
  if (!response.ok) {
    throw new SpriteRenderError(
      `PokeAPI entry fetch returned non-OK status ${response.status} for ${input.pokeapiUrl}`
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    throw new SpriteRenderError(`failed to parse PokeAPI entry JSON from ${input.pokeapiUrl}`, { cause: e });
  }
  const sprites = (body as { sprites?: Record<string, unknown> } | null)?.sprites;
  if (!sprites || typeof sprites !== "object") {
    throw new SpriteRenderError(`PokeAPI entry at ${input.pokeapiUrl} has no sprites object`);
  }
  const url = (sprites as Record<string, unknown>)[input.spriteVariant];
  if (typeof url !== "string" || url.length === 0) {
    throw new SpriteVariantNotAvailableError(input.spriteVariant);
  }
  return url;
}

async function fetchPngBytes(url: string, fetcher: Fetcher): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch (e) {
    throw new SpriteRenderError(`failed to fetch sprite PNG at ${url}`, { cause: e });
  }
  if (!response.ok) {
    throw new SpriteRenderError(`sprite PNG fetch returned non-OK status ${response.status} for ${url}`);
  }
  let ab: ArrayBuffer;
  try {
    ab = await response.arrayBuffer();
  } catch (e) {
    throw new SpriteRenderError(`failed to read PNG bytes from ${url}`, { cause: e });
  }
  return Buffer.from(ab);
}

// ---------------------------------------------------------------------------
// Helpers — decode
// ---------------------------------------------------------------------------

export interface DecodedImage {
  width: number;
  height: number;
  data: Buffer;
}

function decodePng(buffer: Buffer): DecodedImage {
  try {
    const img = PNG.sync.read(buffer);
    return { width: img.width, height: img.height, data: img.data };
  } catch (e) {
    throw new SpriteRenderError("failed to decode PNG bytes", { cause: e });
  }
}

export { decodePng };

// ---------------------------------------------------------------------------
// Helpers — rendering
// ---------------------------------------------------------------------------

export interface HalfStats {
  /** Average alpha in [0, 1] across the pixel block. */
  alpha: number;
  /** Average RGB over alpha>0.5 pixels; (0,0,0) if none. */
  rgb: [number, number, number];
}

export interface SpriteGrid {
  cells: { top: HalfStats; bot: HalfStats }[][];
  cols: number;
  rows: number;
}

/**
 * Fetches and decodes a sprite PNG, returning the full cell grid for consumption
 * by both the ASCII renderer and the SVG renderer.
 */
export async function decodeSpriteGrid(input: {
  pokeapiUrl: string;
  bareSpriteName: string;
  spriteVariant: SpriteVariant;
  vaultPath: string;
  fetcher: Fetcher;
}): Promise<SpriteGrid> {
  const spriteUrl = await fetchSpriteUrl(input);
  const pngBuffer = await fetchPngBytes(spriteUrl, input.fetcher);
  const decoded = decodePng(pngBuffer);

  const pxPerCellX = Math.max(1, Math.floor(decoded.width / COLS));
  const pxPerCellHalfY = Math.max(1, Math.floor(decoded.height / (ROWS * HALVES_PER_ROW)));

  const cells: { top: HalfStats; bot: HalfStats }[][] = [];
  for (let row = 0; row < ROWS; row++) {
    const rowCells: { top: HalfStats; bot: HalfStats }[] = [];
    for (let col = 0; col < COLS; col++) {
      const x0 = col * pxPerCellX;
      const x1 = Math.min(decoded.width, x0 + pxPerCellX);
      const yTop0 = row * 2 * pxPerCellHalfY;
      const yTop1 = yTop0 + pxPerCellHalfY;
      const yBot0 = yTop1;
      const yBot1 = Math.min(decoded.height, yBot0 + pxPerCellHalfY);

      const top = sampleHalf(decoded, x0, x1, yTop0, yTop1);
      const bot = sampleHalf(decoded, x0, x1, yBot0, yBot1);
      rowCells.push({ top, bot });
    }
    cells.push(rowCells);
  }

  return { cells, cols: COLS, rows: ROWS };
}

function renderToAscii(img: DecodedImage, mode: ColorMode): string[] {
  const pxPerCellX = Math.max(1, Math.floor(img.width / COLS));
  const pxPerCellHalfY = Math.max(1, Math.floor(img.height / (ROWS * HALVES_PER_ROW)));

  const lines: string[] = [];
  for (let row = 0; row < ROWS; row++) {
    let line = "";
    for (let col = 0; col < COLS; col++) {
      const x0 = col * pxPerCellX;
      const x1 = Math.min(img.width, x0 + pxPerCellX);
      const yTop0 = row * 2 * pxPerCellHalfY;
      const yTop1 = yTop0 + pxPerCellHalfY;
      const yBot0 = yTop1;
      const yBot1 = Math.min(img.height, yBot0 + pxPerCellHalfY);

      const top = sampleHalf(img, x0, x1, yTop0, yTop1);
      const bot = sampleHalf(img, x0, x1, yBot0, yBot1);

      line += renderCell(top, bot, mode);
    }
    if (mode !== "none") {
      // End-of-line reset prevents state bleed into following content.
      line += "\x1b[0m";
    }
    lines.push(line);
  }
  return lines;
}

export function sampleHalf(img: DecodedImage, x0: number, x1: number, y0: number, y1: number): HalfStats {
  let alphaSum = 0;
  let count = 0;
  let rSum = 0, gSum = 0, bSum = 0, opaqueCount = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * img.width + x) * 4;
      const r = img.data[i];
      const g = img.data[i + 1];
      const b = img.data[i + 2];
      const a = img.data[i + 3];
      alphaSum += a;
      count++;
      if (a > 127) {
        rSum += r;
        gSum += g;
        bSum += b;
        opaqueCount++;
      }
    }
  }
  const alpha = count === 0 ? 0 : (alphaSum / count) / 255;
  const rgb: [number, number, number] = opaqueCount === 0
    ? [0, 0, 0]
    : [Math.round(rSum / opaqueCount), Math.round(gSum / opaqueCount), Math.round(bSum / opaqueCount)];
  return { alpha, rgb };
}

function renderCell(top: HalfStats, bot: HalfStats, mode: ColorMode): string {
  const topOpaque = top.alpha >= 0.5;
  const botOpaque = bot.alpha >= 0.5;

  // Pure mask (no escapes).
  if (mode === "none") {
    if (topOpaque && botOpaque) return "█";          // █
    if (topOpaque && !botOpaque) return "▀";         // ▀
    if (!topOpaque && botOpaque) return "▄";         // ▄
    return " ";
  }

  // Both transparent → space (no escapes).
  if (!topOpaque && !botOpaque) return " ";

  // Both opaque → ▀ with fg=top, bg=bot.
  if (topOpaque && botOpaque) {
    return colorEscape(top.rgb, "fg", mode) + colorEscape(bot.rgb, "bg", mode) + "▀";
  }
  // Top only → ▀ with fg=top.
  if (topOpaque) {
    return colorEscape(top.rgb, "fg", mode) + "▀";
  }
  // Bottom only → ▄ with fg=bot.
  return colorEscape(bot.rgb, "fg", mode) + "▄";
}

function colorEscape(rgb: [number, number, number], slot: "fg" | "bg", mode: ColorMode): string {
  if (mode === "truecolor") {
    const [r, g, b] = rgb;
    const code = slot === "fg" ? 38 : 48;
    return `\x1b[${code};2;${r};${g};${b}m`;
  }
  // ansi — quantize.
  const offset = nearestAnsiOffset(rgb);
  if (offset < 60) {
    return slot === "fg" ? `\x1b[${30 + offset}m` : `\x1b[${40 + offset}m`;
  }
  // Bright variant: 90+(offset-60) for fg, 100+(offset-60) for bg.
  const idx = offset - 60;
  return slot === "fg" ? `\x1b[${90 + idx}m` : `\x1b[${100 + idx}m`;
}

function nearestAnsiOffset(rgb: [number, number, number]): number {
  let bestOffset = 0;
  let bestDist = Infinity;
  for (const [pr, pg, pb, offset] of ANSI_PALETTE) {
    const dr = pr - rgb[0];
    const dg = pg - rgb[1];
    const db = pb - rgb[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestOffset = offset;
    }
  }
  return bestOffset;
}
