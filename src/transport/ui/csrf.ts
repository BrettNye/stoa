import type { MiddlewareHandler } from "hono";

export interface CsrfOptions {
  port: number;
  /** Additional origins to allow (e.g. for dev). Default: none. */
  extraOrigins?: string[];
}

export function csrfMiddleware(opts: CsrfOptions): MiddlewareHandler {
  const allowed = new Set<string>([
    `http://127.0.0.1:${opts.port}`,
    `http://localhost:${opts.port}`,
    ...(opts.extraOrigins ?? []),
  ]);
  return async (c, next) => {
    const origin = c.req.header("Origin");
    const isWrite = c.req.method !== "GET" && c.req.method !== "HEAD";
    if (origin === undefined) {
      if (isWrite) return c.json({ ok: false, error: "missing Origin" }, 403);
      return next();
    }
    if (!allowed.has(origin)) {
      return c.json({ ok: false, error: "forbidden origin", origin }, 403);
    }
    return next();
  };
}
