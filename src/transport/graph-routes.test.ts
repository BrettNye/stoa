import { it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerGraphRoutes } from "./graph-routes.js";

function makeVault(): string {
  const vault = mkdtempSync(join(tmpdir(), "stoa-graph-"));
  mkdirSync(join(vault, "_index"));
  writeFileSync(
    join(vault, "_index/pages.json"),
    JSON.stringify({
      pages: [{ id: "a", type: "concept", wiki: "w", path: "p/a.md" }],
    }),
  );
  writeFileSync(
    join(vault, "_index/links.json"),
    JSON.stringify({ a: { outbound: [], inbound: [] } }),
  );
  return vault;
}

it("GET /graph/data returns a normalized graph from the index", async () => {
  const vault = makeVault();
  const app = new Hono();
  registerGraphRoutes(app, { vaultPath: vault } as any);
  const res = await app.request("/graph/data");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.nodes[0].id).toBe("a");
  expect(body.nodes[0].degree).toBe(0);
  expect(Array.isArray(body.links)).toBe(true);
});

it("GET /graph/themes returns { themes: [] } when file is absent", async () => {
  const vault = makeVault();
  const app = new Hono();
  registerGraphRoutes(app, { vaultPath: vault } as any);
  const res = await app.request("/graph/themes");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ themes: [] });
});

it("PUT /graph/themes round-trip: valid body persists and GET returns it", async () => {
  const vault = makeVault();
  const app = new Hono();
  registerGraphRoutes(app, { vaultPath: vault } as any);

  const payload = {
    themes: [
      {
        name: "my-theme",
        palette: "custom",
        defaultBy: "wiki",
        rules: [],
        perWiki: {},
      },
    ],
    active: "my-theme",
  };

  const putRes = await app.request("/graph/themes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  expect(putRes.status).toBe(200);
  const putBody = await putRes.json();
  expect(putBody).toEqual({ ok: true });

  // Verify GET returns what we stored
  const getRes = await app.request("/graph/themes");
  expect(getRes.status).toBe(200);
  const getBody = await getRes.json();
  expect(getBody.themes[0].name).toBe("my-theme");
  expect(getBody.active).toBe("my-theme");
});

it("PUT /graph/themes rejects a malformed theme (bad color) and does NOT persist", async () => {
  const vault = makeVault();
  const app = new Hono();
  registerGraphRoutes(app, { vaultPath: vault } as any);

  const badPayload = {
    themes: [
      {
        name: "bad-theme",
        rules: [
          {
            match: { type: "concept" },
            color: "not-a-hex-color", // invalid
          },
        ],
      },
    ],
  };

  const putRes = await app.request("/graph/themes", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(badPayload),
  });
  expect(putRes.status).toBe(400);

  // Verify the file was NOT written
  const themesPath = join(vault, "graph-themes.json");
  expect(existsSync(themesPath)).toBe(false);
});
