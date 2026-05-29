// stoa/src/transport/ui/index.ts
//
// Wires the Hono app together: applies CSRF middleware, mounts all route
// modules, serves static files, binds to the configured port + address,
// optionally opens the browser, and returns a graceful shutdown handle.

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import open from "open";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { csrfMiddleware } from "./csrf.js";
import { mountReadRoutes } from "./routes-read.js";
import { mountSpriteRoute } from "./routes-sprites.js";
import { mountWriteRoutes } from "./routes-write.js";
import { registerGraphRoutes } from "../graph-routes.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface StartUiServerOpts {
  vaultPath: string;
  port: number;
  bind: string;
  open: boolean;
  fetcher?: typeof fetch;
  defaultWiki?: string;
}

export interface UiServerHandle {
  url: string;
  shutdown: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// startUiServer
// ---------------------------------------------------------------------------

export async function startUiServer(opts: StartUiServerOpts): Promise<UiServerHandle> {
  const { vaultPath, port, bind } = opts;
  const url = `http://${bind}:${port}`;

  // The fetcher defaults to the global fetch
  const fetcher = opts.fetcher ?? fetch;

  // Build the Hono app
  const app = new Hono();

  // ------------------------------------------------------------------
  // Global middlewares (before routes)
  // ------------------------------------------------------------------

  // Cache-Control: no-store for all API routes
  app.use("*", async (c, next) => {
    await next();
    // Only apply no-store to API routes, not static assets
    if (c.req.path.startsWith("/api/")) {
      c.header("Cache-Control", "no-store");
    }
  });

  // CSRF protection for all write operations
  app.use("*", csrfMiddleware({ port }));

  // ------------------------------------------------------------------
  // Redirect GET / to /static/index.html
  // ------------------------------------------------------------------
  app.get("/", (c) => {
    return c.redirect("/static/index.html", 302);
  });

  // ------------------------------------------------------------------
  // API routes
  // ------------------------------------------------------------------
  const startedAt = new Date().toISOString();

  mountReadRoutes(app, { vaultPath, fetcher, defaultWiki: opts.defaultWiki, startedAt });
  mountSpriteRoute(app, { vaultPath, fetcher });
  mountWriteRoutes(app, { vaultPath, fetcher, defaultWiki: opts.defaultWiki });

  // Knowledge-graph viewer data/theme routes (public, read the index).
  // Registered BEFORE the /graph/* static catch-all below so GET /graph/data
  // and /graph/themes hit these handlers, not the static bundle.
  registerGraphRoutes(app, vaultPath);

  // ------------------------------------------------------------------
  // Static file serving: GET /static/*
  // The serveStatic root is relative to the process CWD, so we resolve
  // the actual static directory path and set it relative to CWD.
  // ------------------------------------------------------------------
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const staticParent = __dirname;

  // serveStatic expects a path relative to CWD.
  // path.relative() always produces a correct relative path (using ../ segments
  // when needed), which is correct for all install locations including global npm.
  // serveStatic at /static/* with root=<parent> means request /static/index.html
  // resolves to <root>/static/index.html. If root were staticDir itself, the prefix
  // would double up (/static/static/index.html → 404).
  const relRoot = relative(process.cwd(), staticParent).replace(/\\/g, "/") || ".";
  app.use("/static/*", serveStatic({ root: relRoot }));

  // ------------------------------------------------------------------
  // Knowledge-graph viewer static bundle (built to dist/viewer).
  // CWD-relative, mirroring the posture this mount had on the MCP server
  // before it moved here; 404 (not 500) if the viewer isn't built.
  // ------------------------------------------------------------------
  app.get("/graph", serveStatic({ path: "./dist/viewer/index.html" }));
  app.use("/graph/*", serveStatic({ root: "./dist/viewer" }));
  // Vite emits root-absolute /assets/... references, so serve those at root too.
  app.use("/assets/*", serveStatic({ root: "./dist/viewer" }));

  // ------------------------------------------------------------------
  // Start the HTTP server
  // ------------------------------------------------------------------
  return new Promise<UiServerHandle>((resolveHandle, rejectHandle) => {
    const server = serve(
      {
        fetch: app.fetch,
        port,
        hostname: bind,
        overrideGlobalObjects: false,
      },
      (_info) => {
        // Server is listening — optionally open browser
        if (opts.open) {
          void open(url).catch((err) => console.warn("[stoa] browser open failed:", err));
        }
        resolveHandle({
          url,
          shutdown: makeShutdown(server),
        });
      }
    );

    // Handle errors such as EADDRINUSE (port already in use)
    server.on("error", (err: NodeJS.ErrnoException) => {
      rejectHandle(err);
    });
  });
}

// ---------------------------------------------------------------------------
// makeShutdown — wraps server.close() as an idempotent Promise
// ---------------------------------------------------------------------------

function makeShutdown(server: ReturnType<typeof serve>): () => Promise<void> {
  let closed = false;

  return () => {
    if (closed) {
      return Promise.resolve();
    }
    closed = true;
    return new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  };
}
