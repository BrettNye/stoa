// stoa/src/transport/ui/routes-write.ts
//
// Registers the three write (POST) API endpoints for the UI transport layer.
// Each endpoint wraps an existing tool handler and translates tool-level
// errors into HTTP status codes:
//   - 409: AlreadyClaimedError (race condition on task claim)
//   - 412: ConflictError / OCC mismatch on task claim
//   - 400: validation / body parsing failure
//   - 500: local/server-side failure in Step 1 (profile page creation)
//   - 502: upstream/Stadium failure in Step 2 (register-agent only)

import type { Hono } from "hono";
import { unlinkSync } from "node:fs";
import { z } from "zod";
import type {
  ClaimResponse,
  ClaimConflictResponse,
  PostResponse,
  RegisterAgentResponse,
} from "./types.js";
import { taskClaimTool } from "../../tools/task-claim.js";
import { channelPostTool } from "../../tools/channel-post.js";
import { profileRegisterTool } from "../../tools/profile-register.js";
import { newTool } from "../../tools/new.js";
import { AlreadyClaimedError } from "../../core/tasks.js";
import { ConflictError } from "../../core/pages.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface WriteRoutesCtx {
  vaultPath: string;
  fetcher: typeof fetch;
  defaultWiki?: string;
}

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

const ClaimBody = z.object({
  agent_id: z.string(),
  expected_updated: z.string(),
  wiki: z.string().optional(),
});

const PostBody = z.object({
  content: z.string().min(1),
  wiki: z.string().optional(),
  session_id: z.string().optional(),
});

const RegisterBody = z.object({
  selected_species: z.string().regex(/^[a-z0-9-]+$/),
  dev_specialty: z.string().optional(),
  pokemon_type: z.string().optional(),
  evolution_stage: z.enum(["basic", "stage1", "stage2"]).optional(),
});

// ---------------------------------------------------------------------------
// Route mount
// ---------------------------------------------------------------------------

export function mountWriteRoutes(app: Hono, ctx: WriteRoutesCtx): void {
  const toolCtx = {
    vaultPath: ctx.vaultPath,
    defaultWiki: ctx.defaultWiki,
  };

  // -------------------------------------------------------------------------
  // POST /api/tasks/:id/claim
  // -------------------------------------------------------------------------
  app.post("/api/tasks/:id/claim", async (c) => {
    // Parse + validate request body
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" }, 400);
    }

    const parsed = ClaimBody.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ ok: false, error: "validation error", issues: parsed.error.issues }, 400);
    }

    const taskId = c.req.param("id");
    const { agent_id, expected_updated, wiki } = parsed.data;

    try {
      const result = await taskClaimTool.handler(
        { task_id: taskId, agent_id, expected_updated, wiki },
        toolCtx
      );

      // Build ApiTask from ClaimResult
      const task = {
        id: result.task_id,
        title: taskId,        // tool doesn't return title; use id as fallback
        wiki: wiki ?? ctx.defaultWiki ?? "",
        status: "claimed" as const,
        claimed_by: result.claimed_by,
        claimed_at: result.claimed_at,
        updated: result.updated,
      };

      const body: ClaimResponse = { ok: true, task };
      return c.json(body, 200);
    } catch (err) {
      if (err instanceof AlreadyClaimedError) {
        const body: ClaimConflictResponse = {
          ok: false,
          error: "AlreadyClaimedError",
          actual_claimer: err.claimedBy,
        };
        return c.json(body, 409);
      }
      if (err instanceof ConflictError) {
        const body: ClaimConflictResponse = {
          ok: false,
          error: "OccMismatch",
          current_updated: err.actualUpdated,
        };
        return c.json(body, 412);
      }
      // Unknown error — re-throw as 500
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/channels/:name/posts
  // -------------------------------------------------------------------------
  app.post("/api/channels/:name/posts", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" }, 400);
    }

    const parsed = PostBody.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ ok: false, error: "validation error", issues: parsed.error.issues }, 400);
    }

    const channelName = c.req.param("name");
    const { content, wiki, session_id } = parsed.data;

    try {
      // agent_id is always set server-side; the dashboard posts as human:dashboard
      const result = await channelPostTool.handler(
        {
          channel: channelName,
          content,
          wiki,
          agent_id: "human:dashboard",
          session_id,
        },
        toolCtx
      );

      // channelPostTool returns { id, path, created, channel }
      // Map to ApiChannelEntry for the response
      const entry = {
        id: result.id,
        channel: result.channel,
        wiki: wiki ?? ctx.defaultWiki ?? "",
        author: "human:dashboard",
        ts: result.created,
        excerpt: content.slice(0, 240),
        pageId: result.id,
      };

      const body: PostResponse = { ok: true, entry };
      return c.json(body, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: msg }, 500);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/agents
  // -------------------------------------------------------------------------
  app.post("/api/agents", async (c) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "invalid JSON body" }, 400);
    }

    const parsed = RegisterBody.safeParse(rawBody);
    if (!parsed.success) {
      return c.json({ ok: false, error: "validation error", issues: parsed.error.issues }, 400);
    }

    const { selected_species, dev_specialty, pokemon_type, evolution_stage } = parsed.data;

    // Resolve wiki
    const wiki = ctx.defaultWiki ?? "_agents";

    // Build a title for the profile
    const title = `${selected_species} agent`;

    // Step 1: Create the profile page via newTool (local/server-side operation)
    const frontmatterExtras: Record<string, unknown> = {
      pokemon: selected_species,
      evolution_stage: evolution_stage ?? "basic",
    };
    if (pokemon_type) frontmatterExtras.pokemon_type = pokemon_type;
    if (dev_specialty) frontmatterExtras.dev_specialty = dev_specialty;

    let newResult: Awaited<ReturnType<typeof newTool.handler>>;
    try {
      newResult = await newTool.handler(
        {
          type: "profile",
          wiki,
          title,
          frontmatter: frontmatterExtras,
          status: "draft",
        },
        toolCtx
      );
    } catch (err) {
      // Local server-side failure (disk full, invalid frontmatter, etc.) → 500
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: msg }, 500);
    }

    const profileId = newResult.id;

    // Step 2: Register with Stadium via profileRegisterTool (upstream operation)
    try {
      await profileRegisterTool.handler(
        { profile_id: profileId, wiki },
        toolCtx
      );
    } catch (err) {
      // Stadium / upstream failure → clean up orphan profile file, return 502
      try { unlinkSync(newResult.path); } catch { /* best-effort; ignore if already gone */ }
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ ok: false, error: msg }, 502);
    }

    // Build ApiAgent response
    const agent = {
      id: profileId,
      wiki,
      pokemon: selected_species,
      pokemon_type: pokemon_type,
      evolution_stage: evolution_stage ?? "basic",
      spriteUrl: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${selected_species}.png`,
      updated: newResult.updated,
      claimedTaskCount: 0,
    };

    const body: RegisterAgentResponse = { ok: true, agent };
    return c.json(body, 201);
  });
}
