import { it, expect } from "vitest";
import { Hono } from "hono";
import { csrfMiddleware } from "../../src/transport/ui/csrf.js";

it("rejects POST without Origin header", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.post("/api/x", (c) => c.json({ ok: true }));
  const res = await app.request("/api/x", { method: "POST" });
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body).toEqual({ ok: false, error: "missing Origin" });
});

it("allows POST with 127.0.0.1 Origin matching port", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.post("/api/x", (c) => c.json({ ok: true }));
  const res = await app.request("/api/x", {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:4321" },
  });
  expect(res.status).toBe(200);
});

it("allows POST with localhost Origin matching port", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.post("/api/x", (c) => c.json({ ok: true }));
  const res = await app.request("/api/x", {
    method: "POST",
    headers: { Origin: "http://localhost:4321" },
  });
  expect(res.status).toBe(200);
});

it("rejects POST with mismatched port in Origin", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.post("/api/x", (c) => c.json({ ok: true }));
  const res = await app.request("/api/x", {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:9999" },
  });
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body).toMatchObject({ ok: false, error: "forbidden origin", origin: "http://127.0.0.1:9999" });
});

it("rejects GET with disallowed Origin", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.get("/api/x", (c) => c.json({ ok: true }));
  const res = await app.request("/api/x", {
    method: "GET",
    headers: { Origin: "http://evil.example.com" },
  });
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body).toMatchObject({ ok: false, error: "forbidden origin" });
});

it("allows GET without Origin (direct browser nav)", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.get("/", (c) => c.text("hello"));
  const res = await app.request("/", { method: "GET" });
  expect(res.status).toBe(200);
});

it("allows HEAD without Origin", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.get("/", (c) => c.text("hello"));
  const res = await app.request("/", { method: "HEAD" });
  expect(res.status).toBe(200);
});

it("allows POST with extra origin configured", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321, extraOrigins: ["http://dev.local:3000"] }));
  app.post("/api/x", (c) => c.json({ ok: true }));
  const res = await app.request("/api/x", {
    method: "POST",
    headers: { Origin: "http://dev.local:3000" },
  });
  expect(res.status).toBe(200);
});

it("rejects DELETE without Origin header", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.delete("/api/x", (c) => c.json({ ok: true }));
  const res = await app.request("/api/x", { method: "DELETE" });
  expect(res.status).toBe(403);
  const body = await res.json();
  expect(body).toEqual({ ok: false, error: "missing Origin" });
});

it("rejects PUT without Origin header", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.put("/api/x", (c) => c.json({ ok: true }));
  const res = await app.request("/api/x", { method: "PUT" });
  expect(res.status).toBe(403);
});

it("rejects PATCH without Origin header", async () => {
  const app = new Hono();
  app.use("*", csrfMiddleware({ port: 4321 }));
  app.patch("/api/x", (c) => c.json({ ok: true }));
  const res = await app.request("/api/x", { method: "PATCH" });
  expect(res.status).toBe(403);
});
