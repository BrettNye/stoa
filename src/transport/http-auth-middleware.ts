import type { MiddlewareHandler } from "hono";
import type { TokenVerifier } from "../auth/types.js";

export function httpAuthMiddleware(opts: { verifier: TokenVerifier }): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header("authorization");
    if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
      return c.json(
        { error: "missing_bearer" },
        401,
        { "WWW-Authenticate": 'Bearer error="invalid_request"' },
      );
    }
    const token = auth.slice(7).trim();
    let principal;
    try {
      principal = await opts.verifier.verify(token);
    } catch {
      return c.json(
        { error: "invalid_token" },
        401,
        { "WWW-Authenticate": 'Bearer error="invalid_token"' },
      );
    }
    c.set("principal", principal);
    await next();
  };
}
