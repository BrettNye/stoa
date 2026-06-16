// tests/e2e/server-mode.test.ts
//
// End-to-end test for v0.4 server-mode (spec §13.3 — construction-GC
// dispatch shape). Boots `startHttp` on an ephemeral port against a tmp
// vault, mints two JWTs (operator + worker) with the same secret the
// server is configured with, drives the full create-claim-list dance via
// the MCP Streamable HTTP transport, and asserts the audit trail records
// the worker's `agent_id`.
//
// Architecture note — single transport, per-request bearer auth.
// `startHttp` constructs one `StreamableHTTPServerTransport` in stateful
// mode which only accepts ONE `initialize` total. That's fine for this
// test: the bearer middleware runs per request and stamps a fresh
// principal onto `req.auth.extra.principal` on every POST. So we open one
// MCP session (using the operator bearer), then rotate tokens per tool
// call — operator scope for create/list, worker scope for claim. The
// principal threaded into `authorize()` and `buildCtx()` comes from the
// per-request token, not the session.
//
// Why raw JSON-RPC over fetch instead of `StreamableHTTPClientTransport`?
// The SDK client's `requestInit.headers` is the documented hook for
// adding the bearer token, but it captures the headers on construction —
// rotating tokens between calls (operator vs. worker) is awkward. Raw
// fetch makes the wire shape explicit and matches the way real
// orchestrators talk to the server (mint → POST → parse JSON-RPC).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { startHttp } from "../../src/transport/http.js";

const SECRET = "e2e-secret-32-bytes-minimum-please-yes-please";
const KEY = new TextEncoder().encode(SECRET);

async function mintToken(opts: { sub: string; scopes: string[]; ttl?: string }): Promise<string> {
  return new SignJWT({ scopes: opts.scopes })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(opts.ttl ?? "1h")
    .setSubject(opts.sub)
    .setJti(randomUUID())
    .sign(KEY);
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Parse an MCP /mcp HTTP response body. The transport may return either
 * `application/json` (compact JSON-RPC envelope) or `text/event-stream`
 * (one `data: <json>` line per message). For initialize + tools/call we
 * only care about the first JSON-RPC payload either way.
 */
async function parseMcpResponse(res: Response): Promise<JsonRpcResponse> {
  const ct = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (ct.includes("text/event-stream")) {
    const dataLine = text.split(/\r?\n/).find((l) => l.startsWith("data: "));
    if (!dataLine) throw new Error(`MCP SSE response had no data line: ${text}`);
    return JSON.parse(dataLine.slice("data: ".length)) as JsonRpcResponse;
  }
  return JSON.parse(text) as JsonRpcResponse;
}

async function mcpInitialize(port: number, jwt: string): Promise<{ sessionId: string }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "e2e-construction-gc", version: "0.0.0" },
      },
    }),
  });
  if (!res.ok) throw new Error(`initialize failed: ${res.status} ${await res.text()}`);
  // Per the MCP Streamable HTTP spec, the session id is returned in the
  // `Mcp-Session-Id` response header on the initialize call and must be
  // echoed on every subsequent request.
  const sessionId =
    res.headers.get("mcp-session-id") ?? res.headers.get("Mcp-Session-Id") ?? "";
  if (!sessionId) throw new Error("no mcp-session-id header on initialize response");
  // The transport requires an `initialized` notification before tool calls.
  // Without it, subsequent tools/call requests get rejected with -32602.
  // The notification is fire-and-forget — no response is parsed.
  await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${jwt}`,
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    }),
  });
  return { sessionId };
}

async function mcpCallTool(
  port: number,
  jwt: string,
  sessionId: string,
  tool: string,
  args: unknown,
): Promise<JsonRpcResponse> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${jwt}`,
      "Mcp-Session-Id": sessionId,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now() + Math.floor(Math.random() * 1000),
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  // 200 status with a JSON-RPC error envelope is the normal failure path
  // (e.g. scope denied); only treat non-200 as a transport-level error.
  if (!res.ok) {
    throw new Error(`tools/call ${tool} HTTP ${res.status}: ${await res.text()}`);
  }
  return parseMcpResponse(res);
}

let serverInstance: Server | undefined;
let port: number;
let vault: string;
let sessionId: string;
// Operator token is used to drive initialize + serves as the default
// per-test bearer for any session-level handshake (notifications/initialized).
// Per-tool-call we may override the Authorization header to use a worker token.
let operatorBootstrap: string;

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), "stoa-e2e-server-mode-"));
  // Minimal vault scaffold: a single wiki named "alpha" with the dirs the
  // task tools touch (tasks/), plus an empty _index/ so write-through
  // upserts don't blow up on missing files.
  mkdirSync(join(vault, "wikis", "alpha", "tasks"), { recursive: true });
  mkdirSync(join(vault, "_index"), { recursive: true });
  writeFileSync(join(vault, ".active-wiki"), "alpha");

  process.env.STOA_TOKEN_SIGNING_SECRET = SECRET;
  serverInstance = (await startHttp(
    { vaultPath: vault, defaultWiki: "alpha", mcpMode: false } as any,
    { bindOverride: "127.0.0.1:0" },
  )) as Server;
  await new Promise<void>((resolve) => {
    if (serverInstance!.listening) return resolve();
    serverInstance!.once("listening", () => resolve());
  });
  const addr = serverInstance!.address() as AddressInfo;
  port = addr.port;

  // One session for the whole suite — the SDK transport refuses re-init
  // in stateful mode, and we don't need separate sessions because the
  // bearer middleware re-evaluates the principal on every request.
  operatorBootstrap = await mintToken({ sub: "orchestrator", scopes: ["*:*"] });
  const init = await mcpInitialize(port, operatorBootstrap);
  sessionId = init.sessionId;
});

afterAll(async () => {
  if (serverInstance) {
    await new Promise<void>((resolve) => serverInstance!.close(() => resolve()));
  }
  rmSync(vault, { recursive: true, force: true });
  delete process.env.STOA_TOKEN_SIGNING_SECRET;
});

describe("server-mode e2e: construction-GC dispatch shape", () => {
  it(
    "operator creates a task; worker claims with narrow scope; audit trail records worker",
    async () => {
      // Operator: broad scopes for the orchestration role
      const operator = await mintToken({ sub: "orchestrator", scopes: ["*:*"] });

      // Operator creates the task. Body intentionally contains all four
      // readiness signals (files, scope, out_of_scope, verification) so the
      // downstream claim does not need `force: true`.
      const createResp = await mcpCallTool(port, operator, sessionId, "vault_task", {
        mode: "create",
        wiki: "alpha",
        title: `review the building plan ${randomUUID().slice(0, 8)}`,
        description: [
          "## Scope",
          "Review the plan in plan.md.",
          "",
          "## Out of scope",
          "Building anything.",
          "",
          "## Verification",
          "- [ ] reviewed",
        ].join("\n"),
      });
      expect(createResp.error, JSON.stringify(createResp.error)).toBeUndefined();
      const taskResult = JSON.parse(createResp.result.content[0].text);
      const taskId = taskResult.id as string;
      expect(taskId).toMatch(/^task-/);

      // Mint worker token narrow to this specific task. The worker can claim
      // and update only this id; recall is wildcard for the supporting
      // read-side audit (not exercised here but mirrors the spec shape).
      const worker = await mintToken({
        sub: "fargate-worker-abc123",
        scopes: [
          `vault_task:tasks/${taskId}`,
          "vault_recall:*",
        ],
      });

      // Worker reuses the same MCP session but presents its own bearer.
      // The middleware verifies per-request, so the principal threaded
      // into `authorize()` reflects the worker token, not the operator.
      const claimResp = await mcpCallTool(port, worker, sessionId, "vault_task", {
        mode: "claim",
        task_id: taskId,
        expected_updated: taskResult.updated,
        wiki: "alpha",
      });
      expect(claimResp.error, JSON.stringify(claimResp.error)).toBeUndefined();
      const claim = JSON.parse(claimResp.result.content[0].text);
      expect(claim.claimed_by).toBe("agent:fargate-worker-abc123");

      // Audit trail check: the operator lists claimed tasks for this
      // specific id; the entry should be recorded under the worker's
      // principal-derived agent_id (NOT the operator's).
      const listResp = await mcpCallTool(port, operator, sessionId, "vault_task", {
        mode: "list",
        wiki: "alpha",
        status: "claimed",
      });
      expect(listResp.error, JSON.stringify(listResp.error)).toBeUndefined();
      const list = JSON.parse(listResp.result.content[0].text);
      const justClaimed = list.tasks.filter((t: any) => t.id === taskId);
      expect(justClaimed).toHaveLength(1);
      expect(justClaimed[0].claimed_by).toBe("agent:fargate-worker-abc123");
    },
    30_000,
  );

  it(
    "worker token cannot claim a different task (scope denied)",
    async () => {
      const operator = await mintToken({ sub: "orchestrator", scopes: ["*:*"] });

      // Operator creates two tasks. Append randomness so slugify produces
      // unique ids even when the test runs back-to-back.
      const tag = randomUUID().slice(0, 8);
      const bodyA = [
        "## Scope",
        "Do A in a.md.",
        "",
        "## Out of scope",
        "Anything else.",
        "",
        "## Verification",
        "- [ ] A done",
      ].join("\n");
      const bodyB = [
        "## Scope",
        "Do B in b.md.",
        "",
        "## Out of scope",
        "Anything else.",
        "",
        "## Verification",
        "- [ ] B done",
      ].join("\n");

      const createA = await mcpCallTool(port, operator, sessionId, "vault_task", {
        mode: "create",
        wiki: "alpha",
        title: `scope task A ${tag}`,
        description: bodyA,
      });
      const createB = await mcpCallTool(port, operator, sessionId, "vault_task", {
        mode: "create",
        wiki: "alpha",
        title: `scope task B ${tag}`,
        description: bodyB,
      });
      expect(createA.error).toBeUndefined();
      expect(createB.error).toBeUndefined();
      const taskA = JSON.parse(createA.result.content[0].text);
      const taskB = JSON.parse(createB.result.content[0].text);
      expect(taskA.id).not.toBe(taskB.id);

      // Worker token narrow to task A ONLY.
      const worker = await mintToken({
        sub: "worker-narrow",
        scopes: [`vault_task:tasks/${taskA.id}`],
      });

      // Attempt to claim task B → must be refused by the scope dispatcher
      // before reaching the task handler. The error surfaces in the
      // JSON-RPC envelope (the MCP SDK wraps thrown errors into the
      // `result.content` field for tool calls with `isError: true`, or
      // into the top-level `error` for protocol-level failures — both
      // shapes are checked below).
      const denialResp = await mcpCallTool(port, worker, sessionId, "vault_task", {
        mode: "claim",
        task_id: taskB.id,
        expected_updated: taskB.updated,
        wiki: "alpha",
      });

      const denialText =
        denialResp.error?.message ??
        (denialResp.result?.isError && denialResp.result?.content?.[0]?.text) ??
        JSON.stringify(denialResp);
      expect(denialText).toMatch(/scope denied|forbidden/i);
      // ScopeDeniedError surfaces the axis (`tasks/<id>`) in the message;
      // confirm it references task B specifically so we know it's not
      // some other failure mode bleeding through.
      expect(denialText).toContain(taskB.id);
    },
    30_000,
  );
});
