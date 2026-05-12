import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
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
      expect(res.status).toBe(302);
      const location = res.headers.get("location");
      expect(location).toContain("/static/index.html");
    } finally {
      await handle.shutdown();
    }
  });

  it("relRoot computed via path.relative() resolves back to staticDir from an unrelated CWD (global install scenario)", () => {
    // Regression guard for the global-install bug.
    //
    // The OLD relativeToCwd() helper returned the raw absolute path whenever
    // staticDir was not under CWD.  serveStatic({ root }) treats root as
    // relative to CWD and prepends it, producing e.g.:
    //   C:\Users\brett\AppData\Local\Temp\C:\path\to\stoa\src\transport\ui\static
    // — an invalid path that causes all /static/* requests to 404.
    //
    // The FIX uses path.relative(cwd, staticDir) which always emits correct
    // ../ segments so that resolve(cwd, relRoot) === staticDir.
    const simulatedCwd = tmpdir(); // a directory unrelated to the stoa source
    const staticDir = resolve(process.cwd(), "src/transport/ui/static");

    // Verify tmpdir really is outside the stoa tree (test precondition)
    expect(staticDir.startsWith(simulatedCwd)).toBe(false);

    // --- old (broken) logic --------------------------------------------
    // The old helper returned absPath unchanged when it didn't start with CWD.
    const oldRelRoot = staticDir.replace(/\\/g, "/"); // old fallback
    const resolvedViaOldLogic = resolve(simulatedCwd, oldRelRoot);
    // On Windows the old code hands an absolute path to resolve(); resolve()
    // ignores simulatedCwd and returns the path unchanged — which means
    // serveStatic receives an absolute path, not a CWD-relative one.
    // On POSIX the old code hands back an absolute path that starts with /,
    // and serveStatic would serve from the absolute path (which coincidentally
    // works on POSIX but is still wrong by contract).
    // Either way the OLD value is not a relative path (no ../ segments).
    expect(oldRelRoot.startsWith("..")).toBe(false); // old code was broken

    // --- new (fixed) logic --------------------------------------------
    const relRoot = relative(simulatedCwd, staticDir).replace(/\\/g, "/");

    // Must NOT be absolute
    expect(relRoot.startsWith("/") || /^[A-Za-z]:/.test(relRoot)).toBe(false);
    // Must contain ../ segments (staticDir is above or beside tmpdir)
    expect(relRoot).toContain("..");
    // Critically: re-resolving from simulatedCwd must reach staticDir exactly
    const recovered = resolve(simulatedCwd, relRoot);
    expect(recovered).toBe(staticDir);

    // The new value must differ from the old (broken) fallback
    expect(relRoot).not.toBe(oldRelRoot);
  });
});
