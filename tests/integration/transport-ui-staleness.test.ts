import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { mountReadRoutes } from "../../src/transport/ui/routes-read.js";
import type { ReadRoutesCtx } from "../../src/transport/ui/routes-read.js";
import type { ApiSynthesisStalenessResponse } from "../../src/transport/ui/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColdVault(): string {
  // No _index directory — simulates cold vault
  return mkdtempSync(join(tmpdir(), "vault-staleness-cold-"));
}

function makeWarmVault(): string {
  const vaultPath = mkdtempSync(join(tmpdir(), "vault-staleness-warm-"));
  mkdirSync(join(vaultPath, "_index"), { recursive: true });
  return vaultPath;
}

function makeApp(vaultPath: string): Hono {
  const ctx: ReadRoutesCtx = {
    vaultPath,
    fetcher: fetch,
    startedAt: new Date().toISOString(),
  };
  const app = new Hono();
  mountReadRoutes(app, ctx);
  return app;
}

// Seed _index/pages.json and _index/links.json with one synthesis entry
function seedSynthesisIndex(vaultPath: string): void {
  const synthDir = join(vaultPath, "wikis", "alpha", "synthesis");
  mkdirSync(synthDir, { recursive: true });

  // Write synthesis file with last_compiled
  writeFileSync(
    join(synthDir, "synthesis-test-topic.md"),
    `---
id: synthesis-test-topic
title: Test Topic Synthesis
type: synthesis
wiki: alpha
status: active
created: 2026-01-01
updated: 2026-04-01
last_compiled: 2026-03-01
summary: A test synthesis
---
# Test Topic Synthesis
`
  );

  // Write pages.json referencing the synthesis
  const pagesJson = {
    pages: [
      {
        id: "synthesis-test-topic",
        type: "synthesis",
        wiki: "alpha",
        title: "Test Topic Synthesis",
        summary: "A test synthesis",
        tags: [],
        status: "active",
        created: "2026-01-01",
        updated: "2026-04-01",
        path: "wikis/alpha/synthesis/synthesis-test-topic.md",
      },
      {
        id: "concept-some-concept",
        type: "concept",
        wiki: "alpha",
        title: "Some Concept",
        summary: "A concept",
        tags: [],
        status: "active",
        created: "2026-01-01",
        updated: "2026-04-15",
        path: "wikis/alpha/concepts/concept-some-concept.md",
      },
    ],
  };
  writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify(pagesJson));

  // Write links.json — synthesis-test-topic links to concept-some-concept
  const linksJson: Record<string, { outbound: string[]; inbound: string[] }> = {
    "synthesis-test-topic": {
      outbound: ["concept-some-concept"],
      inbound: [],
    },
    "concept-some-concept": {
      outbound: [],
      inbound: ["synthesis-test-topic"],
    },
  };
  writeFileSync(join(vaultPath, "_index", "links.json"), JSON.stringify(linksJson));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/syntheses/staleness", () => {
  let vaultPath: string;

  afterEach(() => {
    if (vaultPath) {
      rmSync(vaultPath, { recursive: true, force: true });
    }
  });

  // (a) wrapped response shape
  it("returns wrapped {syntheses, generatedAt} shape", async () => {
    vaultPath = makeWarmVault();
    seedSynthesisIndex(vaultPath);

    const app = makeApp(vaultPath);
    const res = await app.request("/api/syntheses/staleness");
    expect(res.status).toBe(200);

    const body = (await res.json()) as ApiSynthesisStalenessResponse;
    expect(Array.isArray(body.syntheses)).toBe(true);
    expect(typeof body.generatedAt).toBe("string");
    // generatedAt should be ISO timestamp
    expect(() => new Date(body.generatedAt)).not.toThrow();
    expect(new Date(body.generatedAt).getTime()).toBeGreaterThan(0);
  });

  it("returns ApiSynthesisStaleness shape for each entry", async () => {
    vaultPath = makeWarmVault();
    seedSynthesisIndex(vaultPath);

    const app = makeApp(vaultPath);
    const res = await app.request("/api/syntheses/staleness");
    expect(res.status).toBe(200);

    const body = (await res.json()) as ApiSynthesisStalenessResponse;
    expect(body.syntheses.length).toBeGreaterThan(0);

    const entry = body.syntheses[0];
    expect(typeof entry.id).toBe("string");
    expect(typeof entry.wiki).toBe("string");
    expect(typeof entry.title).toBe("string");
    // last_compiled is string | null
    expect(entry.last_compiled === null || typeof entry.last_compiled === "string").toBe(true);
    // lag_days is number | null
    expect(entry.lag_days === null || typeof entry.lag_days === "number").toBe(true);
    expect(Array.isArray(entry.stale_inputs)).toBe(true);
  });

  // (b) cold vault returns 200 + empty syntheses
  it("returns 200 with syntheses:[] on cold vault (missing _index)", async () => {
    vaultPath = makeColdVault();

    const app = makeApp(vaultPath);
    const res = await app.request("/api/syntheses/staleness");
    expect(res.status).toBe(200);

    const body = (await res.json()) as ApiSynthesisStalenessResponse;
    expect(body.syntheses).toEqual([]);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("returns 200 with syntheses:[] on warm vault with empty index", async () => {
    vaultPath = makeWarmVault();
    // _index exists but pages.json is empty
    writeFileSync(
      join(vaultPath, "_index", "pages.json"),
      JSON.stringify({ pages: [] })
    );
    writeFileSync(join(vaultPath, "_index", "links.json"), JSON.stringify({}));

    const app = makeApp(vaultPath);
    const res = await app.request("/api/syntheses/staleness");
    expect(res.status).toBe(200);

    const body = (await res.json()) as ApiSynthesisStalenessResponse;
    expect(body.syntheses).toEqual([]);
  });

  // (c) malformed min_lag_days returns 400
  it("returns 400 for min_lag_days=abc", async () => {
    vaultPath = makeWarmVault();

    const app = makeApp(vaultPath);
    const res = await app.request("/api/syntheses/staleness?min_lag_days=abc");
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error).toContain("abc");
  });

  it("returns 400 for min_lag_days=-1 (negative)", async () => {
    vaultPath = makeWarmVault();

    const app = makeApp(vaultPath);
    const res = await app.request("/api/syntheses/staleness?min_lag_days=-1");
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("returns 200 for min_lag_days=0 (valid)", async () => {
    vaultPath = makeWarmVault();
    seedSynthesisIndex(vaultPath);

    const app = makeApp(vaultPath);
    const res = await app.request("/api/syntheses/staleness?min_lag_days=0");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiSynthesisStalenessResponse;
    expect(Array.isArray(body.syntheses)).toBe(true);
  });

  it("returns 200 for valid integer min_lag_days", async () => {
    vaultPath = makeWarmVault();
    seedSynthesisIndex(vaultPath);

    const app = makeApp(vaultPath);
    const res = await app.request("/api/syntheses/staleness?min_lag_days=30");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiSynthesisStalenessResponse;
    expect(Array.isArray(body.syntheses)).toBe(true);
  });

  // (d) wiki param forwarded
  it("forwards ?wiki= param and only returns syntheses from that wiki", async () => {
    vaultPath = makeWarmVault();

    // Seed two wikis with syntheses
    const synthDirAlpha = join(vaultPath, "wikis", "alpha", "synthesis");
    const synthDirBeta = join(vaultPath, "wikis", "beta", "synthesis");
    mkdirSync(synthDirAlpha, { recursive: true });
    mkdirSync(synthDirBeta, { recursive: true });

    writeFileSync(
      join(synthDirAlpha, "synthesis-alpha-topic.md"),
      `---
id: synthesis-alpha-topic
title: Alpha Topic Synthesis
type: synthesis
wiki: alpha
status: active
created: 2026-01-01
updated: 2026-04-01
last_compiled: 2026-03-01
summary: Alpha synthesis
---
`
    );

    writeFileSync(
      join(synthDirBeta, "synthesis-beta-topic.md"),
      `---
id: synthesis-beta-topic
title: Beta Topic Synthesis
type: synthesis
wiki: beta
status: active
created: 2026-01-01
updated: 2026-04-01
last_compiled: 2026-03-01
summary: Beta synthesis
---
`
    );

    const pagesJson = {
      pages: [
        {
          id: "synthesis-alpha-topic",
          type: "synthesis",
          wiki: "alpha",
          title: "Alpha Topic Synthesis",
          summary: "Alpha synthesis",
          tags: [],
          status: "active",
          created: "2026-01-01",
          updated: "2026-04-01",
          path: "wikis/alpha/synthesis/synthesis-alpha-topic.md",
        },
        {
          id: "synthesis-beta-topic",
          type: "synthesis",
          wiki: "beta",
          title: "Beta Topic Synthesis",
          summary: "Beta synthesis",
          tags: [],
          status: "active",
          created: "2026-01-01",
          updated: "2026-04-01",
          path: "wikis/beta/synthesis/synthesis-beta-topic.md",
        },
      ],
    };
    writeFileSync(join(vaultPath, "_index", "pages.json"), JSON.stringify(pagesJson));
    writeFileSync(join(vaultPath, "_index", "links.json"), JSON.stringify({}));

    const app = makeApp(vaultPath);

    // Without filter — returns both
    const resAll = await app.request("/api/syntheses/staleness");
    const bodyAll = (await resAll.json()) as ApiSynthesisStalenessResponse;
    expect(bodyAll.syntheses.length).toBe(2);

    // Filter to alpha — returns only alpha
    const resAlpha = await app.request("/api/syntheses/staleness?wiki=alpha");
    expect(resAlpha.status).toBe(200);
    const bodyAlpha = (await resAlpha.json()) as ApiSynthesisStalenessResponse;
    expect(bodyAlpha.syntheses.length).toBe(1);
    expect(bodyAlpha.syntheses[0].wiki).toBe("alpha");

    // Filter to beta — returns only beta
    const resBeta = await app.request("/api/syntheses/staleness?wiki=beta");
    const bodyBeta = (await resBeta.json()) as ApiSynthesisStalenessResponse;
    expect(bodyBeta.syntheses.length).toBe(1);
    expect(bodyBeta.syntheses[0].wiki).toBe("beta");
  });

  it("returns bare array nowhere in response — must be wrapped", async () => {
    vaultPath = makeWarmVault();
    seedSynthesisIndex(vaultPath);

    const app = makeApp(vaultPath);
    const res = await app.request("/api/syntheses/staleness");
    const body = await res.json();
    // Body itself must NOT be an array
    expect(Array.isArray(body)).toBe(false);
    // Must have syntheses key
    expect("syntheses" in body).toBe(true);
    // Must have generatedAt key
    expect("generatedAt" in body).toBe(true);
  });
});
