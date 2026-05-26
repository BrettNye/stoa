---
id: spec-stoa-server-mode-design
title: "Stoa server-mode design (HTTP transport, token identity, scoped capabilities, real task-claim concurrency)"
date: 2026-05-21
status: draft
target_version: 0.4.0
supersedes: []
related:
  - docs/task-coordination.md
  - docs/agent-memory.md
---

# Stoa server-mode design

## 1. Summary

Stoa today is a stdio-only MCP server. The `agent_id` field on write tools defaults to `"claude-code"` and is unverified, so audit trails are fictionalizable. The task-claim OCC token is the frontmatter `updated:` date — granularity is one day — so two same-day claimants can both succeed.

This spec adds a server mode that lets a Fargate worker (or any networked MCP client) reach Stoa over HTTP with a verified, capability-bounded identity. It also fixes the task-claim concurrency bug by extending the existing `withSerializedIndexWrite` lockfile primitive into the claim hot path, with stale-lock detection added in the same patch. The existing stdio surface keeps working unchanged for solo-laptop users.

The construction-GC platform (Bedrock + Stoa + Agora + reference orchestrator) is the demo scoping target. The reference orchestrator lives in `quarry-systems-platform`, not in any SDK — Stoa knows nothing about Agora, Bedrock, or who is dispatching workers.

## 2. Goals and non-goals

### Goals

1. Make Stoa reachable over the network with bearer-token authentication.
2. Stamp a verified `agent_id` onto every write so the audit trail is structurally truthful.
3. Enforce per-tool, per-axis capability scopes carried on the token.
4. Fix the same-day task-claim race with sub-millisecond mutual exclusion.
5. Preserve stdio behavior for existing users — zero-config breaking changes.
6. Keep Stoa's "files on disk" posture: no database, no server-side token store, no replication primitive.

### Non-goals

1. OAuth issuer surface (Stoa is a token verifier, not an issuer).
2. Multi-replica writers, hot standby, or distributed coordination.
3. Hosted-Stoa SaaS shape (multi-tenant routing posture is documented but not built).
4. RaState integration or any cross-SDK coupling.
5. Backwards compatibility for clients that pass `agent_id` explicitly (hard break in v0.4).

## 3. Architecture overview

The dispatch pipeline has three layers. Each transport produces a `Principal`; the dispatcher consumes it; the tool handler trusts it.

```
                ┌──────────────────────────────────────────────────────────┐
                │  Tool registry  (allTools[] in src/tools/index.ts)       │
                │  - input schema     - scope axis     - handler           │
                └──────────────────────────────────────────────────────────┘
                                         ▲
                                         │  dispatch(name, input, ctx)
                                         │  + scope-check
                ┌──────────────────────────────────────────────────────────┐
                │  Dispatcher  (single chokepoint per transport, in stdio  │
                │   and http handlers — calls buildCtx + scope matcher)    │
                └──────────────────────────────────────────────────────────┘
                            ▲                                       ▲
                            │                                       │
              ┌─────────────┴─────────────┐         ┌───────────────┴────────────────┐
              │  src/transport/stdio.ts   │         │  src/transport/http.ts         │
              │  Principal from           │         │  Principal from                │
              │  resolveStdioIdentity()   │         │  jwt-verifier.verify(bearer)   │
              └───────────────────────────┘         └────────────────────────────────┘
```

Identity is the only thing that differs between transports. Everything downstream — the tool registry, the scope matcher, the lock primitives, the page writes — is shared.

## 4. Module layout (Separation of Concerns)

### 4.1 New modules

| Path | Single responsibility |
|---|---|
| `src/auth/types.ts` | `Principal`, `Scope`, `ToolScope` interfaces. No imports from elsewhere. |
| `src/auth/jwt-verifier.ts` | HMAC-JWT verification. Takes a secret + token; returns `Principal` or throws. |
| `src/auth/scope-match.ts` | Parse `vault_<tool>:<glob>`, match `(tool, axis)` via picomatch. Pure. |
| `src/auth/stdio-identity.ts` | Resolve stdio `Principal` from env → OS user → vault-baked identity file. |
| `src/transport/http-auth-middleware.ts` | Hono middleware: extract bearer, call verifier, attach to context. |
| `src/cli/commands/serve.ts` | `stoa serve` subcommand. Wires HTTP transport + auth middleware. |
| `src/cli/commands/mint-token.ts` | `stoa mint-token` subcommand. Convenience JWT signer. |

### 4.2 Modified modules

| Path | Change |
|---|---|
| `src/transport/stdio.ts` | `DispatchCtx` gains `principal: Principal`. `buildCtx` stamps it. |
| `src/transport/http.ts` | Rewrite the stub: Hono app, MCP `StreamableHTTPServerTransport`, mount middleware. |
| `src/tools/index.ts` | Tool definitions gain `scope: ToolScope` metadata. |
| `src/tools/*.ts` | Each write tool: remove `agent_id` from input schema, declare `scope.axis`. |
| `src/core/index-locking.ts` | Add stale-lock detection on `EEXIST` via `stat().mtimeMs` threshold. |
| `src/core/tasks.ts` | Wrap `claimTask` body in `withSerializedIndexWrite([\`task-${id}\`], ...)`. |
| `src/bin.ts` | Register `serve`, `mint-token` subcommands; pass `-y` through to `init`. |
| `src/config.ts` | Load `.stoa/config.json`; surface `theme`, `bind`, `auth` slots. |
| `src/cli/commands/init.ts` | Add `-y` flag for non-interactive (Docker-friendly) init. |

### 4.3 Interfaces (the contracts the modules share)

```ts
// src/auth/types.ts
export interface Principal {
  agent_id: string;
  scopes: string[];      // e.g. ["vault_recall:*", "vault_task-claim:tasks/review-abc"]
  exp?: number;          // unix seconds; undefined for stdio principals
  source: "stdio" | "http";
}

export interface ToolScope {
  // Compute the axis string the scope glob matches against, given the parsed input.
  axis: (input: unknown) => string;
  // Predicate: if returns true for this invocation, require an "admin:*" or
  // "admin:<tool_name>" scope instead of (or in addition to) the axis match.
  // Stdio principals carry admin scope by default.
  adminOnly?: (input: unknown) => boolean;
  // If true, refuse this tool over HTTP regardless of token scopes. Stdio still allowed.
  httpForbidden?: boolean;
}

export interface TokenVerifier {
  verify(token: string): Promise<Principal>;
}

export interface ScopeMatcher {
  matches(scopes: string[], tool: string, axis: string | null): boolean;
}
```

### 4.4 DRY: one downstream pipeline

Stdio dispatcher (in `transport/stdio.ts`) and HTTP dispatcher (in `transport/http.ts`) both:

1. Resolve `Principal` (different source per transport).
2. Build `DispatchCtx` via `buildCtx(config, eventBundle, principal)`.
3. Look up tool by name.
4. Parse input via `tool.inputSchema`.
5. Run scope check via `ScopeMatcher` using `tool.scope` + parsed input.
6. Invoke `tool.handler(input, ctx)`.

Steps 3–6 are identical between transports. Only step 1 differs. Implementation: a shared `dispatchToolCall(name, rawArgs, principal, ctx) → Result` helper that both transports call.

## 5. Transport layer

### 5.1 Stdio (unchanged surface, internal principal added)

Existing `stoa --mcp` invocation works byte-for-byte. The only change is internal: at startup, `transport/stdio.ts` calls `resolveStdioIdentity(vaultPath, config)` to produce a `Principal` and threads it into every `buildCtx` call.

`resolveStdioIdentity` resolution order:

1. `config.agentId` (from `--agent-id=` flag, if set).
2. `process.env.STOA_AGENT_ID`.
3. Vault-baked `.stoa/identity` file (`{ "default_agent_id": "..." }`).
4. `os.userInfo().username` (lowercased, sanitized).
5. Literal fallback `"stoa-local"`.

Stdio principals carry `scopes: ["admin:*", "*:*"]` — full local trust. The scope matcher treats this as a wildcard pass for every check.

### 5.2 HTTP (new, opt-in)

`stoa serve [--bind=HOST:PORT] [--vault=PATH]` boots an HTTP server. Defaults: `--bind=127.0.0.1:8443`, vault from `STOA_VAULT_PATH` or `--vault=`.

Stack:

- Hono app (`hono` + `@hono/node-server`, already deps for the dashboard).
- `StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk@1.29` in **stateful** mode (`sessionIdGenerator: () => randomUUID()`).
- Auth middleware mounted **before** the MCP route.
- Health endpoint (`GET /health`) returns 200 if vault path exists and is readable; otherwise 503.

Hono route shape:

```ts
// src/transport/http.ts (sketch — DO NOT depend on exact code; the spec governs)
app.use("/mcp", httpAuthMiddleware({ verifier }));
app.all("/mcp", (c) => transport.handleRequest(c.req.raw, c.res.raw));
app.get("/health", (c) => healthCheck(vaultPath));
```

TLS is **not** terminated by Stoa. Production deployments put Stoa behind an ALB / nginx / Caddy that handles TLS. Stoa binds 127.0.0.1 by default; binding to a public interface requires an explicit flag.

### 5.3 Session lifecycle

One MCP session per worker connection. The SDK manages session state in-process (in-memory). Identity binds at the `initialize` call: the middleware verifies the bearer, attaches `AuthInfo` to the request, the transport propagates it onto subsequent messages in the session. Loss of the session (server restart, network blip) requires the client to re-initialize with the same bearer.

## 6. Authentication and identity

### 6.1 Token shape

HS256 JWT with this claim envelope:

```json
{
  "sub": "<agent_id>",
  "iss": "<informational; not trusted>",
  "iat": <unix_seconds>,
  "exp": <unix_seconds>,
  "jti": "<uuid>",
  "scopes": ["<scope_string>", ...]
}
```

- `sub` becomes `Principal.agent_id`. Required.
- `scopes` becomes `Principal.scopes`. Required. Empty array means "authenticated but no permissions"; every call fails scope-check.
- `exp` is enforced strictly. Tokens past `exp` fail verification.
- `iss` is recorded for diagnostics only; Stoa does not check it.
- `jti` is reserved for future denylist support; not consulted in v0.4.

### 6.2 Signing key

Symmetric HMAC-SHA-256. The integrator holds the secret out-of-band and configures it in Stoa's environment as `STOA_TOKEN_SIGNING_SECRET`. Same secret signs and verifies — Stoa trusts the integrator.

The verifier is interface-pluggable (`TokenVerifier`) so a future RS256/JWKS implementation can drop in without touching the dispatcher.

### 6.3 No issuance API

Stoa exposes no token-mint endpoint. The integrator mints locally with any JWT library. The `stoa mint-token` CLI subcommand is a convenience wrapper around `jsonwebtoken.sign()` (or equivalent) that reads `STOA_TOKEN_SIGNING_SECRET` from env:

```
stoa mint-token --agent-id=<id> --scope=<s>[,<s>...] --ttl=<duration>
```

Emits the JWT to stdout. Used at install time to mint long-lived operator tokens and in scripts/tests to mint test tokens.

### 6.4 HTTP principal stamping

The Hono middleware:

1. Reads `Authorization: Bearer <token>`.
2. Calls `verifier.verify(token)`.
3. On failure: returns 401 with `WWW-Authenticate: Bearer error="invalid_token"`.
4. On success: produces `AuthInfo` matching the MCP SDK shape (`{ token, clientId: agent_id, scopes, expiresAt, extra: { agent_id } }`) and attaches it to `req.auth`.

The MCP transport surfaces `req.auth` as `MessageExtraInfo` on every tool call. The dispatcher reads it and constructs `Principal { agent_id, scopes, exp, source: "http" }`.

### 6.5 Removal of `agent_id` from tool inputs

The following tools currently declare `agent_id` in their input schemas; in v0.4 the field is removed entirely:

| Tool | Today | v0.4 |
|---|---|---|
| `vault_channel-post` | `agent_id: z.string().default("claude-code")` | Removed; uses `ctx.principal.agent_id` |
| `vault_agent-journal` | `agent_id: z.string().default("claude-code")` | Removed |
| `vault_task-claim` | `agent_id: z.string()` (required) | Removed |
| `vault_task-update` | `agent_id: z.string().optional()` | Removed |
| `vault_claim` | `authored_by: z.string()` | Removed; uses `ctx.principal.agent_id`. Retract authorization (today: only original `authored_by` may retract) becomes: only original principal id may retract. |
| `vault_agent-memory` | `agent_id: z.string()` | Removed (server stamps from principal) |

Existing pages with `author: agent:claude-code` written prior to v0.4 remain readable. The migration is forward-only.

## 7. Authorization and scope

### 7.1 Grammar

`<tool_name>:<picomatch_glob>` where the glob is matched against the tool's declared axis.

Wildcards:

- `vault_<tool>:*` — any axis value for this tool.
- `admin:*` — required for admin-shaped tools (see 7.4). Held by stdio principals by default; explicit on HTTP tokens.
- `*:*` — full wildcard. Held by stdio principals only. HTTP tokens should not carry it; if minted with `*:*`, it works, but that's a deployment error.

### 7.2 Tool axis declarations

Each tool declares `scope.axis: (input) => string`. Examples:

| Tool | Axis |
|---|---|
| `vault_new` | `wikis/<wiki>/<type>/<id>.md` (the destination path) |
| `vault_task-claim` | `tasks/<task_id>` |
| `vault_task-update` | `tasks/<task_id>` |
| `vault_task-create` | `wikis/<wiki>` (creation lives at wiki granularity) |
| `vault_channel-post` | `channels/<channel>` |
| `vault_agent-journal` | `wikis/<wiki>/journal` |
| `vault_recall` | `wikis/<wiki>` if `input.wiki` set, else `*` |
| `vault_read` | `<resolved_page_path>` |
| `vault_inbox` | `wikis/<wiki>` |
| `vault_claim` | `wikis/<wiki>/claim` |
| `vault_set-active` | `vault` (singleton; scope check against literal `"vault"`) |

### 7.3 Dispatcher gate

The dispatcher applies three gates in order; the matcher only handles the axis gate. SoC: the matcher knows nothing about admin or HTTP semantics.

```ts
// dispatcher (sketch)
function authorize(tool: ToolDefinition, input: unknown, ctx: DispatchCtx): void {
  // (1) HTTP-forbidden gate
  if (ctx.principal.source === "http" && tool.scope.httpForbidden) {
    throw new HttpForbiddenError(tool.name);
  }
  // (2) Admin gate
  const adminRequired = tool.scope.adminOnly?.(input) ?? false;
  if (adminRequired && !hasAdminScope(ctx.principal.scopes, tool.name)) {
    throw new ScopeDeniedError(tool.name, "admin");
  }
  // (3) Axis gate (skipped when admin gate already passed via admin:* — admin
  //     scope subsumes axis scope for the same tool by design)
  const axis = tool.scope.axis(input);
  if (!matches(ctx.principal.scopes, tool.name, axis)) {
    throw new ScopeDeniedError(tool.name, axis);
  }
}

// src/auth/scope-match.ts — pure
export function matches(scopes: string[], tool: string, axis: string): boolean {
  for (const s of scopes) {
    const [prefix, glob = "*"] = s.split(":", 2);
    if (prefix === "*") return true;                                 // *:* wildcard
    if (prefix === "admin" && picomatch.isMatch(tool, glob)) return true; // admin subsumes
    if (prefix !== tool) continue;
    if (picomatch.isMatch(axis, glob)) return true;
  }
  return false;
}

export function hasAdminScope(scopes: string[], tool: string): boolean {
  for (const s of scopes) {
    const [prefix, glob = "*"] = s.split(":", 2);
    if (prefix === "*") return true;
    if (prefix === "admin" && picomatch.isMatch(tool, glob)) return true;
  }
  return false;
}
```

The matcher is pure — no IO, no side effects. Unit-testable in isolation. Used identically by stdio and HTTP dispatchers.

### 7.4 Admin-shaped and HTTP-forbidden tools

`scope.admin = true` means the tool can be called over HTTP only with an explicit `admin:*` scope. Stdio principals have it by default.

`scope.httpForbidden = true` means the tool can never be called over HTTP, regardless of token scopes. Stdio principals can still call it (still authenticated locally).

| Tool | Marker | Reason |
|---|---|---|
| `vault_reindex` | `adminOnly: () => true` | Full index rewrite; expensive; never per-dispatch |
| `vault_sync-agents` | `httpForbidden: true` | Deploys skills to a local filesystem; nonsensical over HTTP |
| `vault_sync-skills` | `httpForbidden: true` | Same |
| `vault_bootstrap-repo` | `httpForbidden: true` | Writes to a consuming repo's directory |
| `vault_seed-substrate` | `httpForbidden: true` | One-time vault scaffolding |
| `vault_new` (when `type==="map"`) | `adminOnly: (i) => i.type === "map"` | Map writes are curation, not dispatch |
| `vault_evolve-profile` | `adminOnly: () => true` | Profile rename + skills redeploy; not per-dispatch |
| `vault_lint --full` | `adminOnly: () => input.scope === "full"` | Whole-vault scan |
| `vault_set-active` | `adminOnly: () => true` | Mutates global vault state |

### 7.5 Scope check happens at every call

Given no Stoa-side issuance, scope-checking must happen at every tool call. The cost is one `picomatch.isMatch` per scope per call — sub-millisecond, cheaper than the disk read that follows.

The check runs in the dispatcher after input parsing and before the tool handler. A failed check raises `ScopeDeniedError` (HTTP 403, or a `code: "SCOPE_DENIED"` error on stdio).

## 8. Task-claim concurrency

### 8.1 The bug

`claimTask` in `src/core/tasks.ts:45-107` reads the task page, checks `claimed_by` in JS, then calls `writePage` with `expected_updated`. The OCC token is the frontmatter `updated:` date (`YYYY-MM-DD`). Two same-day racers both observe `claimed_by` undefined, both pass the date check, both write. Last-writer-wins. Documented in `docs/task-coordination.md` under "Granularity is one day."

### 8.2 Fix: extend the lockfile primitive

`withSerializedIndexWrite` in `src/core/index-locking.ts` already provides `O_EXCL` lockfiles with sorted-key acquisition and try/finally cleanup. Add a per-task lock key:

```ts
// src/core/tasks.ts (sketch)
export async function claimTask(vaultPath, input): Promise<ClaimResult> {
  return withSerializedIndexWrite(vaultPath, [`task-${input.task_id}`], async () => {
    const page = readPage(vaultPath, input.task_id, wiki);
    // ... type check, readiness check, claimed_by check, writePage
  });
}
```

The lock holds for the entire read-check-write sequence. Inside the lock, the existing `writePage` OCC against frontmatter `updated:` stays — it now guards against *staleness* (you read yesterday, someone updated today) rather than concurrency.

Index sidecar locks (`pages.json` etc.) acquired inside `writePage` are distinct keys from `task-<id>`. Sorted-key acquisition prevents deadlock at the primitive level. No nested-lock acquisition loops.

### 8.3 Stale-lock detection

Add to `withSerializedIndexWrite` retry loop: on `EEXIST`, before sleeping, check `fs.statSync(lockPath).mtimeMs`. If older than `STALE_LOCK_THRESHOLD_MS` (default 60_000), `unlinkSync(lockPath)` and retry the open. Unlink-of-missing is a no-op, so two processes simultaneously deciding the lock is stale is safe.

Threshold rationale: legitimate locks are held for milliseconds (one page read + one page write). 60 seconds is two orders of magnitude longer than the worst legitimate case; a lock older than that is almost certainly orphaned from a crashed writer.

Threshold is **not** configurable in v0.4. Burying knobs in config invites bugs. If 60s turns out wrong, change it in a patch.

### 8.4 Why not real-mtime OCC

`core/claims.ts` uses `fs.stat().mtime` ISO-stringified as an OCC token (`MtimeConflictError`). Same primitive could apply to tasks. Rejected because:

- Windows mtime resolution is platform-dependent (NTFS clusters writes; FAT32 is 2-second).
- TOCTTOU window is narrower but nonzero.
- Locks are stronger and reuse tested infrastructure.

Real-mtime OCC stays in `claims.ts` because it works there (single-author, low contention) and rewriting it is out of scope.

## 9. Vault configuration

Vault-level config at `<vault>/.stoa/config.json`:

```json
{
  "theme": "pokemon" | "plain",
  "identity": {
    "default_agent_id": "<string>"
  },
  "auth": {
    "signing_secret_env": "STOA_TOKEN_SIGNING_SECRET",
    "issuer_hint": "<informational>"
  },
  "bind": "127.0.0.1:8443"
}
```

Loaded at startup by `src/config.ts`. Missing file → all defaults apply (theme=pokemon for back-compat, identity from env/OS, bind from CLI flag). Missing keys within the file inherit defaults; no merge complexity beyond JSON.parse.

`theme: "plain"` affects only scaffolding and UX surfaces (`vault_new-profile`, `vault_suggest-pokemon`, `vault_orient`, the dashboard). Enforcement tools (`vault_task-claim`'s `required_pokemon_type` gate) are theme-agnostic: the gate fires when the field exists, period.

## 10. Throughput and index posture

Server-mode v0 is bounded by sidecar-lock RMW cost. Every write contends on the four index sidecar locks (`pages.json`, `tokens.json`, `wikis.json`, `links.json`). Expected steady-state throughput: tens of writes/second for small vaults, single-digit writes/second once `tokens.json` grows past a few MB.

Construction-GC demo load (a handful of workers writing intermittently) is well inside the comfortable range. Single-integrator deployments are the design target.

### 10.1 Documented growth path (not built)

- **Per-wiki sidecar sharding.** `_index/<wiki>/{pages,tokens,wikis,links}.json` instead of one global set. Cross-wiki reads aggregate; different wikis don't contend.
- **Deferred index updates.** Background flusher batches sidecar updates; writes return immediately. Trades read freshness for write latency.
- **SQLite sidecar.** Already on the v2 roadmap from the v1 design spec. The right answer for a multi-integrator high-throughput deployment. Out of scope here.

## 11. Migration: v0.3 → v0.4

### 11.1 Breaking changes

1. `agent_id` removed from input schemas on the tools listed in §6.5. Clients passing the field get a Zod validation error.
2. `vault_new --type=map` now requires `admin:*` over HTTP.
3. `vault_sync-skills`, `vault_sync-agents`, `vault_bootstrap-repo`, `vault_seed-substrate` are HTTP-forbidden. (Stdio behavior unchanged.)

### 11.2 Pre-flight lint

Add a new lint code:

- `AGENT_ID_INPUT_LEAK` (warning) — caller code in `wikis/` or in any repo bootstrapped with `vault_bootstrap-repo` passes `agent_id` to a write tool. Hint: remove the field; the server now stamps it.

The lint runs as part of `vault_lint`. Repo authors run it once to find and update affected call sites before upgrading.

### 11.3 On-disk format

Unchanged. Existing pages with `author: agent:claude-code` remain readable. Frontmatter schemas (page IDs, task fields, channel format) are unchanged.

### 11.4 Release procedure

1. Land the spec.
2. Implement on a feature branch; existing stdio path is untouched, so no feature flag is needed.
3. Tag `v0.4.0-rc.1`, run the smoke test suite, mint a test JWT, exercise the HTTP path end-to-end.
4. Publish `v0.4.0` to npm.
5. Publish the Docker image to GHCR.
6. Update `README.md` with the server-mode quickstart link to `docs/server-mode.md`.

## 12. Deployment guide

Stoa server-mode is delivered as a Docker image plus the existing npm package. The image is the primary deployment artifact.

### 12.1 Image

`ghcr.io/brettnye/stoa:<version>`. Multi-stage build:

```dockerfile
FROM node:20-slim AS build
WORKDIR /build
COPY package*.json tsconfig.json ./
RUN npm ci --omit=dev
COPY src/ ./src/
COPY seed/ ./seed/
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY --from=build /build/dist ./dist
COPY --from=build /build/node_modules ./node_modules
COPY --from=build /build/seed ./seed
COPY --from=build /build/package.json ./
EXPOSE 8443
ENTRYPOINT ["node", "dist/bin.js"]
CMD ["serve", "--bind=0.0.0.0:8443"]
```

### 12.2 First-time install

```bash
# 1. Generate the signing secret
SECRET=$(openssl rand -hex 32)

# 2. Initialize a vault on persistent storage (-y skips prompts; reads env)
docker run --rm -v stoa-vault:/vault \
  -e STOA_VAULT_PATH=/vault \
  ghcr.io/brettnye/stoa:0.4.0 init -y

# 3. Mint the orchestrator's long-lived operator token (broad scopes, days TTL)
docker run --rm -e STOA_TOKEN_SIGNING_SECRET="$SECRET" \
  ghcr.io/brettnye/stoa:0.4.0 mint-token \
    --agent-id=orchestrator \
    --scope='vault_new:wikis/project-*/**,vault_task-create:wikis/project-*/**,vault_recall:*' \
    --ttl=30d
```

The secret and the operator token are stored in the integrator's preferred secrets backend (AWS Secrets Manager, Vault, env files).

### 12.3 Running

Fargate task definition mounts an EFS volume at `/vault`, injects `STOA_VAULT_PATH=/vault` and `STOA_TOKEN_SIGNING_SECRET` from Secrets Manager, runs the image with default `CMD`. Health check hits `GET /health`. ALB on 443 → task on 8443 with TLS termination at the ALB.

For local dev, replace EFS with a bind mount and skip the ALB.

### 12.4 Two-tier credential pattern (integrator-side)

This is a recommendation for integrators, not a Stoa-enforced concept. From Stoa's perspective both tiers are just JWTs that differ in `scopes` and `exp`.

- **Operator token.** Held by the orchestrator process. Long TTL (days/weeks). Broad scopes within the integrator's project namespace. Used for setup operations: creating wikis, creating tasks, creating profiles, reading across the project.
- **Worker token.** Minted per dispatch by the orchestrator. Short TTL (minutes/hour). Narrow scopes bound to the one dispatch (specific task id, specific channel, scoped reads). Passed to the worker as env. Expires when the worker is done.

The orchestrator process is the trust boundary — it holds the signing secret. AI agents (workers) only receive tokens; they never mint.

## 13. Testing strategy

### 13.1 Unit tests

- `src/auth/scope-match.test.ts` — pure-function tests for the matcher: wildcards, prefix mismatch, glob matching, admin shortcut, empty scopes.
- `src/auth/jwt-verifier.test.ts` — valid/expired/wrong-signature/missing-claims tokens.
- `src/auth/stdio-identity.test.ts` — env → OS → vault-file → fallback resolution order.
- `src/core/index-locking.test.ts` — extend existing suite with stale-lock detection: lock-file older than threshold gets unlinked; younger doesn't; concurrent stale detection is safe.
- `src/core/tasks.test.ts` — extend with the race scenario: two concurrent claimants on the same task; exactly one succeeds, the other gets `AlreadyClaimedError`.

### 13.2 Integration tests

- HTTP transport boots, accepts a valid JWT, runs a tool, returns a result.
- Invalid JWT returns 401.
- Valid JWT with insufficient scopes returns scope-denied (HTTP 403 surface; Zod-error-shape over MCP).
- `agent_id` field on input schema is no longer accepted (Zod rejects it).
- Stdio identity resolution: env, no-env-with-OS-user, file-based all work.

### 13.3 E2E

- Full construction-GC-shaped flow against a local Stoa instance: mint operator token → mint worker token → worker claims task → posts to channel → updates task → reads recall. Asserts audit trail records the correct `agent_id`.

### 13.4 What we are not testing

- HTTPS termination (handled outside Stoa).
- Token issuance flows (Stoa doesn't issue).
- Multi-process / multi-replica race conditions (single-process is the design target).

## 14. Out of scope

Explicitly deferred and not implemented in this spec:

1. OAuth issuer endpoints (`/authorize`, `/token`, `/register`, `/revoke`). The SDK ships them; we don't mount them.
2. JWKS / RS256 verification. The `TokenVerifier` interface allows it; the implementation is HMAC-only in v0.4.
3. Token revocation via `jti` denylist. Schema reserves `jti`; v0.4 ignores it.
4. Multi-replica Stoa. Single-process per vault.
5. Multi-tenant routing (per-integrator vault root selected by token claim). Architecture allows; not built.
6. Per-wiki sidecar sharding. Documented growth path; not built.
7. SQLite sidecar. v2.
8. `map.md` auto-section regeneration. Already deferred since v1.5; unchanged.
9. mTLS auth. Bearer-only.
10. Streaming responses for long-running tools (e.g., recall over a huge vault). MCP SDK supports it; not used in v0.4.

## 15. Deliverables checklist

- [ ] `src/auth/{types,jwt-verifier,scope-match,stdio-identity}.ts` modules + unit tests.
- [ ] `src/transport/http.ts` rewrite (replacing the throwing stub).
- [ ] `src/transport/http-auth-middleware.ts`.
- [ ] `src/cli/commands/{serve,mint-token}.ts`.
- [ ] `src/cli/commands/init.ts` updates for `-y`.
- [ ] Tool registry updates: every tool gains `scope` metadata; write tools drop `agent_id`.
- [ ] `src/core/index-locking.ts` stale-lock detection.
- [ ] `src/core/tasks.ts` lock-wrapping for `claimTask`.
- [ ] `src/config.ts` `.stoa/config.json` loader.
- [ ] `Dockerfile` + GHCR publish workflow.
- [ ] `GET /health` endpoint.
- [ ] `docs/server-mode.md` — operator-facing deployment guide.
- [ ] `docs/task-coordination.md` — update §"Concurrency" section to describe the lock-based fix.
- [ ] `AGENT_ID_INPUT_LEAK` lint code.
- [ ] Migration note in `README.md` and `CHANGELOG.md` for v0.4.
- [ ] E2E test exercising the construction-GC-shaped flow against a local instance.
