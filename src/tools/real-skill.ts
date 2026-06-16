// src/tools/real-skill.ts
//
// Consolidated real-skill tool (mode: register | refresh).
//
// mode=register: Reads an existing `move-<id>/SKILL.md` from the active
//   wiki's moves directory, calls Stadium's POST /real-skills/register
//   with (skill_id, skill_md_content), and writes the returned
//   `real_skill_id` and `combat:` advisory block back into the file's
//   frontmatter. Per spec §5.2 the local `combat:` is advisory only —
//   the server's `modifier_function` is canonical.
//
// mode=refresh: Re-derives the modifier from the current SKILL.md content.
//   Requires `real_skill_id` already present in the file's frontmatter;
//   throws "register first" if absent.
import { z } from "zod";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter, serializeFrontmatter } from "../core/frontmatter.js";
import { resolveStadiumConfig } from "../core/stadium-config.js";
import { StadiumClient } from "../core/stadium-client.js";
import { resolveWiki } from "./_resolve-wiki.js";
import { upsertPage } from "../core/index.js";
import type { ToolScope } from "../auth/types.js";

const Input = z.object({
  mode: z.enum(["register", "refresh"]),
  skill_id: z.string().regex(/^move-/),
  wiki: z.string().optional(),
});

type InputType = z.infer<typeof Input>;
type Ctx = { vaultPath: string; defaultWiki?: string };

async function runRegister(input: InputType, ctx: Ctx) {
  const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
  const path = join(
    ctx.vaultPath,
    "wikis",
    wiki,
    "moves",
    input.skill_id,
    "SKILL.md"
  );
  const raw = readFileSync(path, "utf8");

  const config = resolveStadiumConfig();
  const client = new StadiumClient({
    api_key: config.api_key,
    base_url: config.base_url,
  });
  // StadiumApiError surfaces error_code (e.g. `modifier_clamped`,
  // `derivation_failed`) untouched — we let it propagate.
  const result = await client.registerRealSkill({
    skill_id: input.skill_id,
    skill_md_content: raw,
  });

  const { frontmatter, body } = parseFrontmatter(raw);
  const updated = {
    ...frontmatter,
    real_skill_id: result.real_skill_id,
    // Advisory only — server's modifier_function is canonical (spec §5.2).
    combat: result.modifier_function,
  };
  writeFileSync(path, serializeFrontmatter(updated, body));
  await upsertPage(ctx.vaultPath, path);
  return {
    real_skill_id: result.real_skill_id,
    modifier_function: result.modifier_function,
  };
}

async function runRefresh(input: InputType, ctx: Ctx) {
  const wiki = resolveWiki(input.wiki, ctx.defaultWiki, ctx.vaultPath);
  const path = join(
    ctx.vaultPath,
    "wikis",
    wiki,
    "moves",
    input.skill_id,
    "SKILL.md"
  );
  const raw = readFileSync(path, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const real_skill_id = (frontmatter as Record<string, unknown>).real_skill_id;
  if (!real_skill_id) {
    throw new Error(
      `${input.skill_id} has no real_skill_id — register first via vault_real-skill`
    );
  }

  const config = resolveStadiumConfig();
  const client = new StadiumClient({
    api_key: config.api_key,
    base_url: config.base_url,
  });
  const result = await client.refreshRealSkill(String(real_skill_id), {
    skill_md_content: raw,
  });

  const updated = { ...frontmatter, combat: result.modifier_function };
  writeFileSync(path, serializeFrontmatter(updated, body));
  await upsertPage(ctx.vaultPath, path);
  return {
    real_skill_id: result.real_skill_id,
    modifier_function: result.modifier_function,
  };
}

export const realSkillTool = {
  name: "vault_real-skill",
  description:
    "Stadium real-skill from a move-*/SKILL.md. mode: register (first registration, persists real_skill_id + advisory combat) | refresh (re-derive modifier from current SKILL.md).",
  inputSchema: Input,
  scope: {
    axis: () => "stadium",
    adminOnly: () => true,
  } satisfies ToolScope,
  handler: async (input: InputType, ctx: Ctx) =>
    input.mode === "register" ? runRegister(input, ctx) : runRefresh(input, ctx),
};
