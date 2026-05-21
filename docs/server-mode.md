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

## Pointers

For the complete design rationale — authentication model, scope grammar, session lifecycle, task-claim locking, tool axis declarations, and multi-tenant deployment posture — see the spec:

[`docs/superpowers/specs/2026-05-21-stoa-server-mode-design.md`](superpowers/specs/2026-05-21-stoa-server-mode-design.md)
