/**
 * core/sprites-svg — SVG output path for the sprite pipeline.
 *
 * Consumes the shared `decodeSpriteGrid` helper from `sprites-runtime` and
 * emits an `<svg>` document containing one `<rect>` per non-transparent
 * half-pixel cell.
 *
 * Grid dimensions (fixed):
 *   viewBox="0 0 48 48"  (48 cols × 48 visual rows — square aspect)
 *   Each rect: x=col, y=halfRow*2, width=1, height=2
 *   The source PNG is 96×96; the half-block encoding downsamples 2x horizontally
 *   and 4x vertically (one character row = 2 half-pixels = 4 source rows). For
 *   ASCII rendering each character cell renders ~2:1 tall so the aspect comes
 *   out square in a terminal. For SVG/PNG rendering we double the vertical
 *   pixel size to recover the original square aspect.
 *
 * Color modes (matching `sprites-runtime` semantics):
 *   "truecolor" → fill="rgb(R,G,B)"
 *   "ansi"      → quantize to nearest ANSI 16-color entry; fill as CSS hex
 *   "none"      → single silhouette color fill="#222" for all opaque cells
 *
 * Caching: `<vaultPath>/_index/sprites/<bareSpriteName>-<colorMode>.svg`
 *   (mode IS in the filename so different modes coexist)
 */

import { existsSync, promises as fsp } from "node:fs";
import { join, dirname } from "node:path";
import {
  type ColorMode,
  type Fetcher,
  type SpriteVariant,
  type HalfStats,
  ANSI_PALETTE,
  decodeSpriteGrid,
} from "./sprites-runtime.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SpriteSvgInput {
  pokeapiUrl: string;
  bareSpriteName: string;
  spriteVariant: SpriteVariant;
  colorMode: ColorMode;
  vaultPath: string;
  fetcher: Fetcher;
}

export interface SpriteSvgOutput {
  svg: string;
  cachePath: string;
  source: "cached" | "rendered";
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

export async function renderSpriteSvg(input: SpriteSvgInput): Promise<SpriteSvgOutput> {
  const cachePath = resolveSvgCachePath(input);

  if (existsSync(cachePath)) {
    const svg = await fsp.readFile(cachePath, "utf8");
    return { svg, cachePath, source: "cached" };
  }

  const grid = await decodeSpriteGrid(input);
  const svg = emitSvg(grid, input.colorMode);

  await fsp.mkdir(dirname(cachePath), { recursive: true });
  await fsp.writeFile(cachePath, svg, "utf8");

  return { svg, cachePath, source: "rendered" };
}

// ---------------------------------------------------------------------------
// Helpers — path resolution
// ---------------------------------------------------------------------------

function resolveSvgCachePath(input: SpriteSvgInput): string {
  const dir = join(input.vaultPath, "_index", "sprites");
  const filename = `${input.bareSpriteName}-${input.colorMode}.svg`;
  return join(dir, filename);
}

// ---------------------------------------------------------------------------
// Helpers — SVG emission
// ---------------------------------------------------------------------------

const SVG_COLS = 48;
const SVG_ROWS = 48; // 12 char rows × 2 halves × 2 vertical scale = 48 (matches 96px source aspect)
const HALF_PIXEL_HEIGHT = 2; // each half-pixel rendered as 1×2 to recover square aspect

function emitSvg(
  grid: { cells: { top: HalfStats; bot: HalfStats }[][]; cols: number; rows: number },
  mode: ColorMode
): string {
  const rects: string[] = [];

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cell = grid.cells[row][col];

      // Top half — y = row*4 (two half-pixels per char row × 2 scale)
      if (cell.top.alpha >= 0.5) {
        const fill = resolveColor(cell.top, mode);
        rects.push(`<rect x="${col}" y="${row * 4}" width="1" height="${HALF_PIXEL_HEIGHT}" fill="${fill}"/>`);
      }

      // Bottom half — y = row*4 + 2 (offset by one half-pixel of height 2)
      if (cell.bot.alpha >= 0.5) {
        const fill = resolveColor(cell.bot, mode);
        rects.push(`<rect x="${col}" y="${row * 4 + 2}" width="1" height="${HALF_PIXEL_HEIGHT}" fill="${fill}"/>`);
      }
    }
  }

  const inner = rects.join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_COLS} ${SVG_ROWS}" ` +
    `width="${SVG_COLS}" height="${SVG_ROWS}" shape-rendering="crispEdges">` +
    inner +
    `</svg>`
  );
}

function resolveColor(half: HalfStats, mode: ColorMode): string {
  if (mode === "none") {
    return "#222";
  }

  if (mode === "truecolor") {
    const [r, g, b] = half.rgb;
    return `rgb(${r},${g},${b})`;
  }

  // ansi — quantize to nearest palette entry
  return nearestAnsiHex(half.rgb);
}

function nearestAnsiHex(rgb: [number, number, number]): string {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < ANSI_PALETTE.length; i++) {
    const [pr, pg, pb] = ANSI_PALETTE[i];
    const dr = pr - rgb[0];
    const dg = pg - rgb[1];
    const db = pb - rgb[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  const [pr, pg, pb] = ANSI_PALETTE[bestIdx];
  return rgbToHex(pr, pg, pb);
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + toHex(r) + toHex(g) + toHex(b);
}

function toHex(n: number): string {
  return n.toString(16).padStart(2, "0");
}
