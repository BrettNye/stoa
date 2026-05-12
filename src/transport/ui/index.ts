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

  // ------------------------------------------------------------------
  // Static file serving: GET /static/*
  // The serveStatic root is relative to the process CWD, so we resolve
  // the actual static directory path and set it relative to CWD.
  // ------------------------------------------------------------------
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const staticDir = resolve(__dirname, "static");

  // serveStatic expects a path relative to CWD.
  // path.relative() always produces a correct relative path (using ../ segments
  // when needed), which is correct for all install locations including global npm.
  const relRoot = relative(process.cwd(), staticDir).replace(/\\/g, "/");
  app.use("/static/*", serveStatic({ root: relRoot }));

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
