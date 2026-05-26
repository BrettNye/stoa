import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { httpAuthMiddleware } from "./http-auth-middleware.js";
import type { TokenVerifier, Principal } from "../auth/types.js";

const fakeVerifier: TokenVerifier = {
  async verify(token: string): Promise<Principal> {
    if (token !== "good") throw new Error("bad");
    return { agent_id: "tester", scopes: ["vault_recall:*"], exp: undefined, source: "http" };
  },
};

describe("httpAuthMiddleware", () => {
  it("attaches principal when token verifies", async () => {
    const app = new Hono<{ Variables: { principal: Principal } }>();
    app.use("/x", httpAuthMiddleware({ verifier: fakeVerifier }));
    app.get("/x", (c) => c.json(c.get("principal")));
    const res = await app.request("/x", { headers: { Authorization: "Bearer good" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ agent_id: "tester" });
  });
  it("returns 401 with WWW-Authenticate on missing bearer", async () => {
    const app = new Hono();
    app.use("/x", httpAuthMiddleware({ verifier: fakeVerifier }));
    app.get("/x", (c) => c.text("ok"));
    const res = await app.request("/x");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
  });
  it("returns 401 with WWW-Authenticate on non-Bearer scheme", async () => {
    const app = new Hono();
    app.use("/x", httpAuthMiddleware({ verifier: fakeVerifier }));
    app.get("/x", (c) => c.text("ok"));
    const res = await app.request("/x", { headers: { Authorization: "Basic xyz" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Bearer/);
  });
  it("returns 401 when verifier throws", async () => {
    const app = new Hono();
    app.use("/x", httpAuthMiddleware({ verifier: fakeVerifier }));
    app.get("/x", (c) => c.text("ok"));
    const res = await app.request("/x", { headers: { Authorization: "Bearer bad" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/invalid_token/);
  });
  it("propagates downstream errors rather than converting them to 401", async () => {
    const app = new Hono();
    app.use("/x", httpAuthMiddleware({ verifier: fakeVerifier }));
    app.get("/x", () => { throw new Error("db exploded"); });
    // Hono's default behavior is to surface thrown errors as 500
    const res = await app.request("/x", { headers: { Authorization: "Bearer good" } });
    expect(res.status).not.toBe(401);
  });
});
