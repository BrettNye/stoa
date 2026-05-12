import { describe, it, expect } from "vitest";
import { startUiServer } from "../../src/transport/ui/index.js";

describe("startUiServer", () => {
  it("serves the dashboard on the bound port", async () => {
    const handle = await startUiServer({
      vaultPath: process.cwd(),
      port: 4399,
      bind: "127.0.0.1",
      open: false,
    });
    try {
      const res = await fetch(`${handle.url}/api/health`);
      expect(res.status).toBe(200);
    } finally {
      await handle.shutdown();
    }
  });

  it("rejects writes from foreign Origin", async () => {
    const handle = await startUiServer({
      vaultPath: process.cwd(),
      port: 4398,
      bind: "127.0.0.1",
      open: false,
    });
    try {
      const res = await fetch(`${handle.url}/api/tasks/x/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://evil.example.com" },
        body: "{}",
      });
      expect(res.status).toBe(403);
    } finally {
      await handle.shutdown();
    }
  });

  it("returns url with http://<bind>:<port>", async () => {
    const handle = await startUiServer({
      vaultPath: process.cwd(),
      port: 4397,
      bind: "127.0.0.1",
      open: false,
    });
    try {
      expect(handle.url).toBe("http://127.0.0.1:4397");
    } finally {
      await handle.shutdown();
    }
  });

  it("shutdown() is idempotent", async () => {
    const handle = await startUiServer({
      vaultPath: process.cwd(),
      port: 4396,
      bind: "127.0.0.1",
      open: false,
    });
    await handle.shutdown();
    // calling again should not throw
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  it("rejects port already in use", async () => {
    const handle = await startUiServer({
      vaultPath: process.cwd(),
      port: 4395,
      bind: "127.0.0.1",
      open: false,
    });
    try {
      await expect(
        startUiServer({
          vaultPath: process.cwd(),
          port: 4395,
          bind: "127.0.0.1",
          open: false,
        })
      ).rejects.toThrow();
    } finally {
      await handle.shutdown();
    }
  });

  it("GET / redirects to /static/index.html", async () => {
    const handle = await startUiServer({
      vaultPath: process.cwd(),
      port: 4394,
      bind: "127.0.0.1",
      open: false,
    });
    try {
      const res = await fetch(`${handle.url}/`, { redirect: "manual" });
      expect(res.status).toBe(301);
      const location = res.headers.get("location");
      expect(location).toContain("/static/index.html");
    } finally {
      await handle.shutdown();
    }
  });
});
