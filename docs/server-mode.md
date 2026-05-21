# Stoa Server Mode — Operator Deployment Guide

## Overview

Stoa normally runs as a stdio MCP server: a local process that Claude Code (or any MCP client) forks directly. Server mode is an opt-in HTTP transport that makes the same tool surface reachable over the network, with bearer-token authentication and capability-bounded identities. It is intended for operators running multi-agent pipelines — Fargate workers, Agora dispatched processes, CI job fleets — that cannot share a process boundary with Stoa. Solo-laptop users running `stoa --mcp` are unaffected and require no changes.

---

## Install Artifact

The v0.4 Docker image is published as:

```text
ghcr.io/brettnye/stoa:0.4.0
```

> Note: this image path documents the canonical release coordinate. The image itself is built from the multi-stage Dockerfile at the root of this repo (`node:20-slim` base, `CMD ["serve", "--bind=0.0.0.0:8443"]`). It will be published on the first CI-triggered push to the release tag; pull will fail until then.

---

## Persistent Storage

The vault is a plain filesystem tree. Stoa has no embedded database and makes no assumptions about the underlying block device.

| Deployment target | Recommended storage |
|---|---|
| AWS Fargate | Amazon EFS volume, mounted at `/vault` in the task definition |
| AWS ECS on EC2 | EBS volume, bind-mounted at `/vault`; pin the task to the instance |
| Local development | Host bind mount (`-v ./my-vault:/vault`) |

Set the vault path via the `STOA_VAULT_PATH` environment variable or the `--vault=` flag passed to `stoa serve`.

---

## Auth Secrets

Stoa uses one environment variable for token signing and verification:

```text
STOA_TOKEN_SIGNING_SECRET=<hex string>
```

The integrator generates this value, holds it out-of-band, and injects it into every Stoa container and into any process that mints tokens (the orchestrator). Stoa never exposes or rotates it.

Generate a fresh secret with:

```bash
openssl rand -hex 32
```

---

## TLS Posture

Stoa serves plain HTTP. It does not terminate TLS itself.

- **Production:** place Stoa behind an ALB, nginx, or Caddy instance that handles TLS. Stoa binds `127.0.0.1:8443` by default, so it is only reachable from the same host unless `--bind=0.0.0.0:8443` is set explicitly.
- **Local development:** `127.0.0.1` is the default bind address; TLS is optional.

Configure the external TLS terminator to forward plain HTTP to Stoa's bind port. Workers and the orchestrator communicate with Stoa over HTTPS at the terminator's address, never directly to Stoa's HTTP port.

---

## Network Reachability

Workers and the orchestrator must reach Stoa over HTTPS in a production deployment. Stoa itself does not manage discovery or DNS.

| Context | Recommended approach |
|---|---|
| AWS VPC | ALB with HTTPS listener; workers resolve the ALB DNS name |
| Local laptop demo | [ngrok](https://ngrok.com/) (`ngrok http 8443`) or [Tailscale](https://tailscale.com/) to tunnel the local port |
| CI / GitHub Actions | ngrok ephemeral URL or a small EC2/Fargate instance provisioned per run |

---

## Day-Zero Install

The following sequence initializes a fresh vault and mints a long-lived operator token. Run these steps before your first deployment.

```bash
# 1. Generate and export the signing secret
export STOA_TOKEN_SIGNING_SECRET=$(openssl rand -hex 32)
```

```bash
# 2. Initialize the vault headlessly (non-interactive -y mode reads STOA_VAULT_PATH)
docker run --rm \
  -v stoa-vault:/vault \
  -e STOA_VAULT_PATH=/vault \
  ghcr.io/brettnye/stoa:0.4.0 \
  init -y
```

```bash
# 3. Mint a long-lived operator token (printed to stdout; store securely)
docker run --rm \
  -e STOA_TOKEN_SIGNING_SECRET="$STOA_TOKEN_SIGNING_SECRET" \
  ghcr.io/brettnye/stoa:0.4.0 \
  mint-token \
    --agent-id=orchestrator \
    --scope='vault_new:wikis/project-*/**,vault_task-create:wikis/project-*/**,vault_recall:*' \
    --ttl=30d
```

Save the token that `mint-token` prints to stdout. This is your operator credential; treat it as a secret.

---

## Running Stoa

### Fargate task definition (sketch)

```json
{
  "family": "stoa",
  "containerDefinitions": [
    {
      "name": "stoa",
      "image": "ghcr.io/brettnye/stoa:0.4.0",
      "command": ["serve", "--bind=0.0.0.0:8443", "--vault=/vault"],
      "portMappings": [{ "containerPort": 8443 }],
      "environment": [
        { "name": "STOA_VAULT_PATH", "value": "/vault" }
      ],
      "secrets": [
        {
          "name": "STOA_TOKEN_SIGNING_SECRET",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789:secret:stoa/signing-secret"
        }
      ],
      "mountPoints": [
        {
          "containerPath": "/vault",
          "sourceVolume": "stoa-vault"
        }
      ],
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -sf http://localhost:8443/health || exit 1"],
        "interval": 10,
        "timeout": 5,
        "retries": 3
      }
    }
  ],
  "volumes": [
    {
      "name": "stoa-vault",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-xxxxxxxxx",
        "rootDirectory": "/stoa"
      }
    }
  ]
}
```

Attach an ALB HTTPS listener (port 443) that forwards to this task on port 8443.

### Local development (bind mount)

```bash
docker run --rm \
  -v "$(pwd)/my-vault:/vault" \
  -e STOA_VAULT_PATH=/vault \
  -e STOA_TOKEN_SIGNING_SECRET="$STOA_TOKEN_SIGNING_SECRET" \
  -p 8443:8443 \
  ghcr.io/brettnye/stoa:0.4.0 \
  serve --bind=0.0.0.0:8443
```

---

## Two-Tier Credential Pattern

This is the recommended convention for integrators managing multiple workers.

**Operator token** — long-lived (30d), broad scopes. Held only by the orchestrator. Used to set up shared resources: create wikis, create tasks, assign profiles.

**Worker token** — short-lived (minutes to hours), narrow scopes. Minted by the orchestrator immediately before dispatching a worker. Handed to the worker as an environment variable. Scopes are limited to exactly what the specific work item requires.

Both tokens are HS256 JWTs signed with the same `STOA_TOKEN_SIGNING_SECRET`. Stoa verifies both identically — the tiering is an integrator convention, not a protocol distinction.

Example scope sets:

| Role | Example scopes |
|---|---|
| Operator | `vault_new:wikis/project-*/**,vault_task-create:wikis/project-*/**,vault_recall:*` |
| Worker (claim + update one task) | `vault_task-claim:tasks/review-abc,vault_task-update:tasks/review-abc,vault_recall:wikis/project-beta/**,vault_agent-journal:wikis/project-beta/journal` |

---

## Per-Dispatch Flow

1. **Orchestrator** authenticates to Stoa with the operator token.
2. Orchestrator creates wikis and tasks as needed (`vault_task-create`, `vault_new`).
3. Orchestrator locally mints a **worker JWT** with scopes narrowed to the specific task and relevant wiki paths. The signing key is the same `STOA_TOKEN_SIGNING_SECRET`; no Stoa API call is required.
4. Orchestrator dispatches the worker (Fargate task, Agora sub-agent, etc.) with `STOA_TOKEN` set to the worker JWT and `STOA_SERVER_URL` set to the ALB HTTPS endpoint.
5. Worker presents its bearer token to Stoa on every MCP call. Stoa stamps `agent_id` from the verified `sub` claim — the worker cannot forge its own identity.
6. Worker claims its task (`vault_task-claim`), performs work, and updates the task (`vault_task-update`). Narrow scopes prevent it from touching other workers' tasks or unrelated wikis.
7. Worker token expires automatically; no revocation required.

---

## Migration from stdio

Solo-laptop users running `stoa --mcp` are unaffected. The stdio transport continues to work without configuration changes. Server mode is strictly opt-in — nothing starts listening on a port unless you run `stoa serve`.

**v0.4 breaking change:** `agent_id` has been removed from the input schemas of all write tools (`vault_channel-post`, `vault_agent-journal`, `vault_task-claim`, `vault_task-update`, `vault_task-create`, `vault_claim`, `vault_agent-memory`). Callers that pass `agent_id` explicitly will receive a Zod parse error. The server now stamps `agent_id` from the verified principal.

To find affected call sites in your repository, run:

```bash
stoa lint
```

and look for `AGENT_ID_INPUT_LEAK` codes. See [CHANGELOG.md](../CHANGELOG.md) for the full breaking-change notice.

---

## Health Check

Stoa exposes a health endpoint at:

```http
GET /health
```

- Returns `200 OK` when the vault path exists and is readable.
- Returns `503 Service Unavailable` otherwise.

Use this endpoint for ALB target group health checks and Fargate liveness/readiness probes.

---

## Troubleshooting

### `error: vault path required: pass --vault=<path> or set STOA_VAULT_PATH`

The container started but has no vault to operate against. Either `STOA_VAULT_PATH` is unset, or no `--vault=` flag was passed, or the named volume isn't mounted.

```bash
# Wrong — no vault path:
docker run --rm stoa-local

# Right — env var + mounted volume:
docker run --rm -v stoa-vault:/vault -e STOA_VAULT_PATH=/vault stoa-local
```

If the volume exists but the path inside the container doesn't, double-check the `-v <volume>:<container-path>` and `-e STOA_VAULT_PATH=<container-path>` match.

### `error: STOA_TOKEN_SIGNING_SECRET environment variable must be set`

`stoa serve` fails at startup if the signing secret env var is missing. Generate one with `openssl rand -hex 32` and inject it at run time. In production, source it from Secrets Manager / SSM Parameter Store / Vault — never bake it into the image.

```bash
docker run --rm -p 8443:8443 \
  -v stoa-vault:/vault -e STOA_VAULT_PATH=/vault \
  -e STOA_TOKEN_SIGNING_SECRET="$(openssl rand -hex 32)" \
  stoa-local
```

### `401 Unauthorized` on `POST /mcp`

The request did not present a valid `Authorization: Bearer <jwt>` header. Causes in rough order of likelihood:

1. **No `Authorization` header at all.** Add it.
2. **JWT signed with a different secret** than the running server. Rotate to the same secret on both sides, or mint a fresh token.
3. **Expired token.** Check the `exp` claim. Mint a fresh one (`stoa mint-token --ttl=1h`).
4. **Malformed bearer.** The header must be exactly `Authorization: Bearer <token>` — no extra whitespace, no missing `Bearer ` prefix.

`/health` does **not** require auth — use it to verify the server itself is reachable independently of token issues.

### Tool call returns `ScopeDeniedError` or `HttpForbiddenError`

The token verified, but its scopes don't grant the operation:

- `ScopeDeniedError(<axis>)` — your token's scopes don't match the tool's axis for these inputs. Mint a broader token, or correct the path/wiki/task-id you're targeting.
- `ScopeDeniedError("admin")` — the tool requires `admin:*` (or `admin:<tool>`) and the token lacks it. Admin tools include `vault_reindex`, `vault_evolve-profile`, `vault_set-active`, `vault_new-wiki`, `vault_lint --scope=full`, and map writes via `vault_new`.
- `HttpForbiddenError` — the tool is HTTP-forbidden entirely (`vault_sync-skills`, `vault_sync-agents`, `vault_bootstrap-repo`, `vault_seed-substrate`). Run those over stdio on a trusted host instead.

### Code changes don't take effect inside the container

Docker caches layers and the image is built from `dist/` (compiled). If you edited source on the host:

```bash
# Rebuild from worktree root:
cd C:/Users/brett/Documents/Knowledge/stoa/.worktrees/server-mode
docker build -t stoa-local .

# Then run the new image:
docker run --rm ... stoa-local
```

For a tight inner loop on local code changes, skip docker entirely:

```bash
npm run build
node dist/bin.js serve --vault=./my-vault --bind=127.0.0.1:8443
```

### `ghcr.io/brettnye/stoa:0.4.0` pull fails

The published image path is the canonical release coordinate but is published only on tagged release builds. Until a v0.4.0 tag has been cut and pushed, build the image locally with `docker build -t stoa-local .` from the repo root and use `stoa-local` in place of the published name.

### Vault appears empty on first `vault_recall` after init

`stoa init -y` scaffolds the vault structure but does not seed content. Either:

- Run `stoa --vault=/vault seed-substrate` (or the equivalent inside the container) to install the bundled `_agents` content, or
- Mount an existing populated vault into `/vault`, or
- Create your project wikis via `vault_new-wiki` from your orchestrator.

### Tokens minted before changing the signing secret stop verifying

Tokens are bound to the exact secret used at signing time. Rotating `STOA_TOKEN_SIGNING_SECRET` invalidates every outstanding token. There is no revocation list in v0.4 — rotation is the only invalidation primitive. Plan rotations to coincide with operator-token expiry.

### Windows / Git Bash (MSYS) gotchas

Git Bash on Windows (MINGW64, the shell that ships with Git for Windows) rewrites Unix-shaped paths before passing them to native Windows commands. `docker.exe` is a native Windows binary, so `-e STOA_VAULT_PATH=/vault` becomes `-e STOA_VAULT_PATH=C:/Program Files/Git/vault` inside the container. The server then reports `/health` as `unhealthy` because that mangled path doesn't exist.

Three fixes, pick one:

**Option A — disable conversion per command:**

```bash
MSYS_NO_PATHCONV=1 docker run --rm -p 8443:8443 \
  -v stoa-vault:/vault \
  -e STOA_VAULT_PATH=/vault \
  -e STOA_TOKEN_SIGNING_SECRET="$STOA_TOKEN_SIGNING_SECRET" \
  stoa-local
```

**Option B — disable conversion for the whole session:**

```bash
export MSYS_NO_PATHCONV=1
# every subsequent docker command in this terminal works as-is
```

**Option C — double-slash escape (path-by-path):**

```bash
docker run --rm -v stoa-vault://vault -e STOA_VAULT_PATH=//vault stoa-local init -y
```

The leading `//` tells MSYS "leave this alone." Linux inside the container treats `//vault` and `/vault` identically.

**Option D — switch to PowerShell:**

PowerShell doesn't do MSYS path conversion. The same `docker run` lines from this guide work as-is.

### Bind-mount path syntax on Windows

Both forms work with Docker Desktop, but watch for shell quoting on paths with spaces:

```bash
# Forward-slash form (Git Bash, PowerShell)
-v "C:/Users/brett/stoa-test-vault:/vault"

# Posix form (Git Bash auto-translates back to Windows for Docker)
-v "/c/Users/brett/stoa-test-vault:/vault"
```

If your host path contains spaces, always quote the whole `-v` value. Combine with `MSYS_NO_PATHCONV=1` to keep the container-side `/vault` half from getting rewritten.

### Inline `$(openssl rand -hex 32)` is single-use

`docker run -e STOA_TOKEN_SIGNING_SECRET="$(openssl rand -hex 32)"` generates a fresh secret each time. The server you started yesterday and the `mint-token` you ran today will have different secrets — tokens won't verify.

Save the secret to your shell env (or a file) once and reuse it across the session:

```bash
export STOA_TOKEN_SIGNING_SECRET=$(openssl rand -hex 32)
echo $STOA_TOKEN_SIGNING_SECRET   # verify it's set

# Server and any subsequent mint-token calls now share the same secret:
docker run --rm -p 8443:8443 -v stoa-vault:/vault \
  -e STOA_VAULT_PATH=/vault \
  -e STOA_TOKEN_SIGNING_SECRET="$STOA_TOKEN_SIGNING_SECRET" \
  stoa-local

# In another tab — note exports don't cross shells, so paste the value:
export STOA_TOKEN_SIGNING_SECRET="<paste the 64-hex string>"
docker run --rm -e STOA_TOKEN_SIGNING_SECRET="$STOA_TOKEN_SIGNING_SECRET" \
  stoa-local mint-token --agent-id=tester --scope='vault_recall:*' --ttl=1h
```

For multi-tab workflows, save the secret to a file and source it:

```bash
echo "export STOA_TOKEN_SIGNING_SECRET=$(openssl rand -hex 32)" > ~/.stoa-dev-secret
chmod 600 ~/.stoa-dev-secret
source ~/.stoa-dev-secret   # do this in every tab that talks to the server
```

---

## Pointers

For the complete design rationale — authentication model, scope grammar, session lifecycle, task-claim locking, tool axis declarations, and multi-tenant deployment posture — see the spec:

[`docs/superpowers/specs/2026-05-21-stoa-server-mode-design.md`](superpowers/specs/2026-05-21-stoa-server-mode-design.md)
