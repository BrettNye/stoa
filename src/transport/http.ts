import { Hono } from "hono";
import { serve, type ServerType } from "@hono/node-server";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { VaultConfig } from "../config.js";
import { loadVaultStoaConfig } from "../config.js";
import { allTools } from "../tools/index.js";
import { JwtVerifier } from "../auth/jwt-verifier.js";
import { authorize } from "../auth/dispatcher.js";
import { httpAuthMiddleware } from "./http-auth-middleware.js";
import { healthHandler } from "./health.js";
import { buildCtx } from "./stdio.js";
import type { Principal } from "../auth/types.js";

// Re-export so future surfaces can use the same ctx construction.
export { buildCtx };
export type { DispatchCtx } from "./stdio.js";

export interface StartHttpOptions {
  /**
   * Override `bind` from `.stoa/config.json`. Useful for tests that need an
   * OS-assigned port — pass `"127.0.0.1:0"` and read `.address()` off the
   * returned server.
   */
  bindOverride?: string;
}

/**
 * Boot the HTTP transport. Returns the underlying Node `http.Server` so
 * callers (notably integration tests) can `.address()` and `.close()` it.
 *
 * Spec: `docs/superpowers/specs/2026-05-21-stoa-server-mode-design.md` §5.2.
 *
 * Stack:
 *   - Hono app with `/health` (public) and `/mcp` (bearer-gated).
 *   - `StreamableHTTPServerTransport` in stateful mode (random session IDs).
 *   - Bearer middleware verifies the JWT and stamps `c.get("principal")`.
 *   - On each MCP tool call, `authorize()` runs the three-gate dispatcher
 *     (httpForbidden -> admin -> axis) before invoking the handler.
 */
export async function startHttp(
  config: VaultConfig,
  opts: StartHttpOptions = {},
): Promise<ServerType> {
  const stoaCfg = loadVaultStoaConfig(config.vaultPath);
  const secret = process.env[stoaCfg.auth.signing_secret_env];
  if (!secret) {
    throw new Error(
      `${stoaCfg.auth.signing_secret_env} environment variable must be set for HTTP transport`,
    );
  }
  const verifier = new JwtVerifier(secret);

  // MCP server + Streamable HTTP transport in stateful mode.
  const mcp = new Server(
    { name: "stoa", version: "0.4.0" },
    { capabilities: { tools: {} } },
  );

  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema as any) as any,
    })),
  }));

  mcp.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const tool = allTools.find((t) => t.name === req.params.name);
    if (!tool) throw new Error(`unknown tool: ${req.params.name}`);
    const parsed = tool.inputSchema.parse(req.params.arguments ?? {});
    // Principal arrives via the SDK's AuthInfo plumbing — we stash it under
    // `authInfo.extra.principal` from the middleware boundary. Fall back to
    // a top-level `principal` field for forward-compat.
    const authInfo: any = extra?.authInfo;
    const principal: Principal | undefined =
      authInfo?.extra?.principal ?? authInfo?.principal;
    if (!principal) {
      throw new Error("no principal on request (auth middleware misconfigured)");
    }
    const ctx = buildCtx(config, undefined, principal);
    authorize(tool as any, parsed, ctx.principal);
    const result = await (tool as any).handler(parsed as any, ctx as any);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });
  await mcp.connect(transport);

  const app = new Hono<{ Variables: { principal: Principal } }>();

  app.get(
    "/health",
    healthHandler({ vaultPath: config.vaultPath, version: "0.4.0" }),
  );

  // The graph viewer and its data/theme routes are served by the `stoa ui`
  // dashboard server, not here — `stoa serve` is the programmatic agent plane
  // (bearer-gated MCP) and must not carry a public human-facing UI surface.
  // See decision-2026-05-29-graph-viewer-served-by-stoa-ui-not-mcp-serve.

  // Bearer middleware mounts before the catch-all /mcp route so unauthenticated
  // requests get a 401 (with WWW-Authenticate) before touching the transport.
  app.use("/mcp", httpAuthMiddleware({ verifier }));
  app.all("/mcp", async (c) => {
    const principal = c.get("principal");
    // @hono/node-server exposes the raw Node objects via c.env.{incoming,outgoing}.
    // The MCP SDK's StreamableHTTPServerTransport.handleRequest expects Node
    // IncomingMessage/ServerResponse and reads `req.auth` to populate AuthInfo
    // on subsequent message handlers (extra.authInfo).
    const env = c.env as { incoming: IncomingMessage; outgoing: ServerResponse };
    const nodeReq = env.incoming as IncomingMessage & {
      auth?: {
        token: string;
        clientId: string;
        scopes: string[];
        expiresAt?: number;
        extra?: Record<string, unknown>;
      };
    };
    const nodeRes = env.outgoing;
    nodeReq.auth = {
      token: "", // middleware doesn't retain the raw token; not needed downstream
      clientId: principal.agent_id,
      scopes: principal.scopes,
      expiresAt: principal.exp,
      extra: { principal },
    };
    await transport.handleRequest(nodeReq, nodeRes);
    // The transport writes directly to nodeRes and fully ends the response.
    // Return the @hono/node-server "already-sent" sentinel so the Hono pipeline
    // skips its own writeHead/end pass — preventing ERR_HTTP_HEADERS_SENT.
    return new Response(null, { headers: { "x-hono-already-sent": "1" } });
  });

  const bind = opts.bindOverride ?? stoaCfg.bind;
  const [hostRaw, portStr] = bind.split(":");
  const hostname = hostRaw || "127.0.0.1";
  const port = Number(portStr || "8443");

  const server = serve({ fetch: app.fetch, hostname, port });
  process.stderr.write(
    `stoa http server ready on ${hostname}:${port} (vault=${config.vaultPath})\n`,
  );
  return server;
}
