import type { Hono, Env } from "hono";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { VaultConfig } from "../config.js";
import { buildGraph } from "../core/graph.js";
import { PagesIndex, LinksIndex } from "../types/graph.js";
import { ThemesFile } from "../types/theme.js";

// Accepts a Hono app with any env bindings (e.g. startHttp's app carries a
// `principal` Variable) — these routes are public and read no context state.
export function registerGraphRoutes<E extends Env>(app: Hono<E>, config: VaultConfig): void {
  const idxDir = join(config.vaultPath, "_index");
  const themesPath = join(config.vaultPath, "graph-themes.json");

  app.get("/graph/data", (c) => {
    const pages = PagesIndex.parse(
      JSON.parse(readFileSync(join(idxDir, "pages.json"), "utf8")),
    ).pages;
    const links = LinksIndex.parse(
      JSON.parse(readFileSync(join(idxDir, "links.json"), "utf8")),
    );
    return c.json(buildGraph(pages, links));
  });

  app.get("/graph/themes", (c) =>
    c.json(
      existsSync(themesPath)
        ? JSON.parse(readFileSync(themesPath, "utf8"))
        : { themes: [] },
    ),
  );

  app.put("/graph/themes", async (c) => {
    let body: ReturnType<typeof ThemesFile.parse>;
    try {
      body = ThemesFile.parse(await c.req.json());
    } catch (err) {
      return c.json({ error: "invalid themes body", details: String(err) }, 400);
    }
    const tmp = `${themesPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(body, null, 2));
    renameSync(tmp, themesPath); // atomic replace
    return c.json({ ok: true });
  });
}
