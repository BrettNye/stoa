/**
 * transport/ui/routes-sprites — GET /api/sprites/:nameSvg
 *
 * Serves SVG sprites for agent pokemon. Calls `renderSpriteSvg` from
 * `core/sprites-svg.ts` and returns the SVG with `Content-Type: image/svg+xml`.
 *
 * Color mode precedence:
 *   1. `?mode=<truecolor|ansi|none>` query param (override)
 *   2. `display_config.sprites.color_mode` from vault config
 *   3. "truecolor" (DEFAULT_DISPLAY_CONFIG fallback)
 *
 * Cache-Control is set to `public, max-age=86400` (1 day) for successful
 * renders. X-Sprite-Source is set to "cached" or "rendered" for observability.
 */

import type { Hono } from "hono";
import { renderSpriteSvg, type SpriteSvgInput, type SpriteSvgOutput } from "../../core/sprites-svg.js";
import { readDisplayConfig } from "../../core/display-config.js";
import type { ColorMode } from "../../core/sprites-runtime.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SpriteRouteCtx {
  vaultPath: string;
  fetcher: typeof fetch;
  /**
   * Optional override for the render function. Used in tests to avoid
   * network calls. Defaults to `renderSpriteSvg` from `core/sprites-svg.ts`.
   */
  renderFn?: (input: SpriteSvgInput) => Promise<SpriteSvgOutput>;
}

// ---------------------------------------------------------------------------
// Route mounting
// ---------------------------------------------------------------------------

export function mountSpriteRoute(app: Hono, ctx: SpriteRouteCtx): void {
  const render = ctx.renderFn ?? renderSpriteSvg;

  app.get("/api/sprites/:nameSvg", async (c) => {
    const raw = c.req.param("nameSvg");

    // Must end with .svg
    if (!raw.endsWith(".svg")) {
      return c.json({ ok: false, error: "expected .svg suffix" }, 400);
    }

    const bareSpriteName = raw.slice(0, -4);

    // Only allow lowercase letters, digits, and hyphens
    if (!/^[a-z0-9-]+$/.test(bareSpriteName)) {
      return c.json({ ok: false, error: "invalid sprite name" }, 400);
    }

    // Resolve color mode: query param > vault config > default
    const cfg = readDisplayConfig(ctx.vaultPath);
    const cfgMode: ColorMode = cfg.sprites.color_mode;
    const queryMode = c.req.query("mode") as ColorMode | undefined;
    const colorMode: ColorMode = queryMode ?? cfgMode;

    try {
      const out = await render({
        pokeapiUrl: `https://pokeapi.co/api/v2/pokemon/${bareSpriteName}`,
        bareSpriteName,
        spriteVariant: "front_default",
        colorMode,
        vaultPath: ctx.vaultPath,
        fetcher: ctx.fetcher,
      });

      return c.body(out.svg, 200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "public, max-age=86400",
        "X-Sprite-Source": out.source,
      });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 502);
    }
  });
}
