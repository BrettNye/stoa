import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { healthHandler } from "./health.js";

describe("healthHandler", () => {
  it("returns 200 + ok when vault path is readable", async () => {
    const app = new Hono();
    app.get("/health", healthHandler({ vaultPath: process.cwd(), version: "test" }));
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", version: "test" });
  });
  it("returns 503 when vault path is unreadable", async () => {
    const app = new Hono();
    app.get("/health", healthHandler({ vaultPath: "/does/not/exist/anywhere", version: "test" }));
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    const body = await res.json() as any;
    expect(body.status).toBe("unhealthy");
  });
});
