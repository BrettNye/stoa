/**
 * Integration tests for the sprite route.
 * GET /api/sprites/:nameSvg
 */

import { it, expect } from "vitest";
import { Hono } from "hono";
import { mountSpriteRoute, type SpriteRouteCtx } from "../../src/transport/ui/routes-sprites.js";
import type { ColorMode } from "../../src/core/sprites-runtime.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeSvg(name: string, mode: ColorMode): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" data-name="${name}" data-mode="${mode}"></svg>`;
}

type FetcherFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

function makeCtx(overrides: Partial<SpriteRouteCtx> = {}): SpriteRouteCtx {
  return {
    vaultPath: "/tmp/fake-vault",
    fetcher: fetch as FetcherFn,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Path-traversal / validation guard
// ---------------------------------------------------------------------------

it("rejects names with path-traversal characters", async () => {
  const app = new Hono();
  mountSpriteRoute(app, makeCtx());
  const res = await app.request("/api/sprites/..%2Fevil.svg");
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.ok).toBe(false);
});

it("rejects names with uppercase letters", async () => {
  const app = new Hono();
  mountSpriteRoute(app, makeCtx());
  const res = await app.request("/api/sprites/Pikachu.svg");
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.error).toBe("invalid sprite name");
});

it("rejects names with special characters", async () => {
  const app = new Hono();
  mountSpriteRoute(app, makeCtx());
  const res = await app.request("/api/sprites/pika_chu.svg");
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.error).toBe("invalid sprite name");
});

it("rejects requests without .svg suffix", async () => {
  const app = new Hono();
  mountSpriteRoute(app, makeCtx());
  const res = await app.request("/api/sprites/pikachu.png");
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.error).toBe("expected .svg suffix");
});

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

it("returns image/svg+xml with 200 on success", async () => {
  const app = new Hono();

  // Stub renderSpriteSvg via context — we need a fake renderSpriteSvg
  // We test this by injecting a mock fetcher + a fake vaultPath that causes
  // renderSpriteSvg to be called. But since renderSpriteSvg makes real PokeAPI
  // calls, we use a spy approach: override the module via a fake context.
  //
  // Instead, we test that the route correctly propagates what renderSpriteSvg
  // returns by mocking the whole render function through a test seam.
  //
  // The route doesn't expose a render-fn seam in SpriteRouteCtx, so we test
  // the 502 error path (renderSpriteSvg throwing) and the validation path
  // (400), then test the success path using a renderFn override.

  // Since the route imports renderSpriteSvg directly (no DI), we test success
  // by mounting a fresh Hono app that uses a special vaultPath that has a
  // cached SVG already on disk (no network call needed).
  //
  // For the integration test, we instead provide an injectable render function
  // via an optional field on SpriteRouteCtx.

  // Actually let's check the route's accepted SpriteRouteCtx shape for a
  // renderFn override. See implementation for how this is tested.

  // For now we use the renderFn optional override.
  const fakeSvg = makeFakeSvg("pikachu", "truecolor");
  const ctx: SpriteRouteCtx = {
    vaultPath: "/tmp/fake-vault",
    fetcher: fetch as FetcherFn,
    renderFn: async (_input) => ({
      svg: fakeSvg,
      cachePath: "/tmp/fake-vault/_index/sprites/pikachu-truecolor.svg",
      source: "rendered" as const,
    }),
  };

  mountSpriteRoute(app, ctx);
  const res = await app.request("/api/sprites/pikachu.svg");

  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
  const text = await res.text();
  expect(text).toBe(fakeSvg);
});

it("sets Cache-Control: public, max-age=86400 on success", async () => {
  const app = new Hono();
  const ctx: SpriteRouteCtx = {
    vaultPath: "/tmp/fake-vault",
    fetcher: fetch as FetcherFn,
    renderFn: async (_input) => ({
      svg: "<svg></svg>",
      cachePath: "/tmp/fake-vault/_index/sprites/bulbasaur-truecolor.svg",
      source: "cached" as const,
    }),
  };

  mountSpriteRoute(app, ctx);
  const res = await app.request("/api/sprites/bulbasaur.svg");

  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=86400");
});

it("sets X-Sprite-Source header to the source field from renderFn", async () => {
  const app = new Hono();
  const ctx: SpriteRouteCtx = {
    vaultPath: "/tmp/fake-vault",
    fetcher: fetch as FetcherFn,
    renderFn: async (_input) => ({
      svg: "<svg></svg>",
      cachePath: "/tmp/fake-vault/_index/sprites/charmander-truecolor.svg",
      source: "cached" as const,
    }),
  };

  mountSpriteRoute(app, ctx);
  const res = await app.request("/api/sprites/charmander.svg");

  expect(res.headers.get("X-Sprite-Source")).toBe("cached");
});

it("sets X-Sprite-Source: rendered when source is rendered", async () => {
  const app = new Hono();
  const ctx: SpriteRouteCtx = {
    vaultPath: "/tmp/fake-vault",
    fetcher: fetch as FetcherFn,
    renderFn: async (_input) => ({
      svg: "<svg></svg>",
      cachePath: "/tmp/fake-vault/_index/sprites/squirtle-truecolor.svg",
      source: "rendered" as const,
    }),
  };

  mountSpriteRoute(app, ctx);
  const res = await app.request("/api/sprites/squirtle.svg");

  expect(res.headers.get("X-Sprite-Source")).toBe("rendered");
});

// ---------------------------------------------------------------------------
// Error path (502)
// ---------------------------------------------------------------------------

it("returns 502 with error message when renderFn throws", async () => {
  const app = new Hono();
  const ctx: SpriteRouteCtx = {
    vaultPath: "/tmp/fake-vault",
    fetcher: fetch as FetcherFn,
    renderFn: async (_input) => {
      throw new Error("PokeAPI is down");
    },
  };

  mountSpriteRoute(app, ctx);
  const res = await app.request("/api/sprites/pikachu.svg");

  expect(res.status).toBe(502);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.error).toBe("PokeAPI is down");
});

it("returns 502 with string error message when renderFn throws a non-Error", async () => {
  const app = new Hono();
  const ctx: SpriteRouteCtx = {
    vaultPath: "/tmp/fake-vault",
    fetcher: fetch as FetcherFn,
    renderFn: async (_input) => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "blew up";
    },
  };

  mountSpriteRoute(app, ctx);
  const res = await app.request("/api/sprites/pikachu.svg");

  expect(res.status).toBe(502);
  const body = await res.json();
  expect(body.ok).toBe(false);
  expect(body.error).toBe("blew up");
});

// ---------------------------------------------------------------------------
// ?mode= query param override
// ---------------------------------------------------------------------------

it("passes colorMode from query param to renderFn", async () => {
  const app = new Hono();
  let capturedMode: ColorMode | undefined;

  const ctx: SpriteRouteCtx = {
    vaultPath: "/tmp/fake-vault",
    fetcher: fetch as FetcherFn,
    renderFn: async (input) => {
      capturedMode = input.colorMode;
      return {
        svg: "<svg></svg>",
        cachePath: "/tmp",
        source: "rendered" as const,
      };
    },
  };

  mountSpriteRoute(app, ctx);
  await app.request("/api/sprites/pikachu.svg?mode=ansi");

  expect(capturedMode).toBe("ansi");
});

it("passes colorMode=none when ?mode=none", async () => {
  const app = new Hono();
  let capturedMode: ColorMode | undefined;

  const ctx: SpriteRouteCtx = {
    vaultPath: "/tmp/fake-vault",
    fetcher: fetch as FetcherFn,
    renderFn: async (input) => {
      capturedMode = input.colorMode;
      return {
        svg: "<svg></svg>",
        cachePath: "/tmp",
        source: "rendered" as const,
      };
    },
  };

  mountSpriteRoute(app, ctx);
  await app.request("/api/sprites/pikachu.svg?mode=none");

  expect(capturedMode).toBe("none");
});

it("uses truecolor default when no ?mode param and no vault config", async () => {
  const app = new Hono();
  let capturedMode: ColorMode | undefined;

  const ctx: SpriteRouteCtx = {
    vaultPath: "/tmp/fake-vault-no-config",
    fetcher: fetch as FetcherFn,
    renderFn: async (input) => {
      capturedMode = input.colorMode;
      return {
        svg: "<svg></svg>",
        cachePath: "/tmp",
        source: "rendered" as const,
      };
    },
  };

  mountSpriteRoute(app, ctx);
  await app.request("/api/sprites/pikachu.svg");

  // Default from display-config when CLAUDE.md doesn't exist is "truecolor"
  expect(capturedMode).toBe("truecolor");
});
