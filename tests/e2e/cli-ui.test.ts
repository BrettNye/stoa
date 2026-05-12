/**
 * e2e tests for `stoa ui` subcommand.
 *
 * Uses a unit-test style: imports `registerUi`, mounts it on a fresh Command,
 * and asserts on side effects via mocked `startUiServer`. This avoids the
 * brittleness of child_process spawning compiled JS while still exercising
 * the wiring and error handling logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { mkdtempSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be hoisted before any imports that use them)
// ─────────────────────────────────────────────────────────────────────────────

// Mock startUiServer so we don't spin up a real server
vi.mock("../../src/transport/ui/index.js", () => {
  const mockShutdown = vi.fn().mockResolvedValue(undefined);
  const mockStartUiServer = vi.fn();
  return {
    startUiServer: mockStartUiServer,
    _mockShutdown: mockShutdown,
  };
});

// Mock getCtx so we can inject a controlled vault path without real config
vi.mock("../../src/cli/_ctx.js", () => {
  const mockGetCtx = vi.fn();
  return { getCtx: mockGetCtx };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function runUiCommand(args: string[], vaultPath: string): Promise<void> {
  // Dynamic imports after mock setup
  const { registerUi } = await import("../../src/cli/commands/ui.js");
  const { getCtx } = await import("../../src/cli/_ctx.js");
  const mockedGetCtx = vi.mocked(getCtx);
  mockedGetCtx.mockReturnValue({ vaultPath, mcpMode: false });

  const program = new Command();
  program.exitOverride(); // prevent process.exit from killing vitest
  registerUi(program);
  await program.parseAsync(["node", "stoa", "ui", ...args]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("stoa ui command wiring", () => {
  let tmpVault: string;
  let stderrOutput: string;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(async () => {
    tmpVault = mkdtempSync(join(tmpdir(), "stoa-ui-test-"));
    stderrOutput = "";

    // Capture stderr
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrOutput += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    }) as typeof process.stderr.write;

    // Reset mocks
    const { startUiServer } = await import("../../src/transport/ui/index.js");
    const mockedStart = vi.mocked(startUiServer);
    mockedStart.mockReset();

    // Default mock: resolves immediately and SIGINT listener is set then triggered by test
    mockedStart.mockImplementation(async (opts) => {
      const url = `http://${opts.bind}:${opts.port}`;
      return {
        url,
        shutdown: vi.fn().mockResolvedValue(undefined),
      };
    });
  });

  afterEach(() => {
    process.stderr.write = originalStderrWrite;
    try {
      rmdirSync(tmpVault);
    } catch {
      // best-effort cleanup
    }
    vi.clearAllMocks();
  });

  it("default flags bind to 127.0.0.1:4321 and print URL to stderr", async () => {
    const { startUiServer } = await import("../../src/transport/ui/index.js");
    const mockedStart = vi.mocked(startUiServer);

    // The action awaits SIGINT — we'll trigger it after parseAsync starts
    let resolveWait!: () => void;
    const waitPromise = new Promise<void>((res) => { resolveWait = res; });

    mockedStart.mockImplementation(async (opts) => {
      const url = `http://${opts.bind}:${opts.port}`;
      // Schedule SIGINT emit asynchronously after handle is returned
      setImmediate(() => process.emit("SIGINT" as NodeJS.Signals, "SIGINT"));
      return {
        url,
        shutdown: vi.fn().mockImplementation(async () => { resolveWait(); }),
      };
    });

    const exitCalls: number[] = [];
    const origExit = process.exit.bind(process);
    process.exit = ((code?: number) => {
      exitCalls.push(code ?? 0);
      // Don't actually exit, just record
    }) as typeof process.exit;

    try {
      await runUiCommand([], tmpVault);
      await waitPromise;
    } finally {
      process.exit = origExit;
    }

    expect(mockedStart).toHaveBeenCalledWith(
      expect.objectContaining({
        vaultPath: resolve(tmpVault),
        port: 4321,
        bind: "127.0.0.1",
        open: true,
      })
    );
    expect(stderrOutput).toContain("stoa ui → http://127.0.0.1:4321");
    expect(stderrOutput).toContain(`vault: ${resolve(tmpVault)}`);
    expect(exitCalls).toContain(0);
  });

  it("--port=5000 --no-open --bind=127.0.0.1 passes correct opts", async () => {
    const { startUiServer } = await import("../../src/transport/ui/index.js");
    const mockedStart = vi.mocked(startUiServer);

    let resolveWait!: () => void;
    const waitPromise = new Promise<void>((res) => { resolveWait = res; });

    mockedStart.mockImplementation(async (opts) => {
      const url = `http://${opts.bind}:${opts.port}`;
      setImmediate(() => process.emit("SIGINT" as NodeJS.Signals, "SIGINT"));
      return {
        url,
        shutdown: vi.fn().mockImplementation(async () => { resolveWait(); }),
      };
    });

    const exitCalls: number[] = [];
    const origExit = process.exit.bind(process);
    process.exit = ((code?: number) => {
      exitCalls.push(code ?? 0);
    }) as typeof process.exit;

    try {
      await runUiCommand(["--port=5000", "--no-open", "--bind=127.0.0.1"], tmpVault);
      await waitPromise;
    } finally {
      process.exit = origExit;
    }

    expect(mockedStart).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 5000,
        bind: "127.0.0.1",
        open: false,
      })
    );
    expect(stderrOutput).toContain("stoa ui → http://127.0.0.1:5000");
    expect(exitCalls).toContain(0);
  });

  it("port-in-use → exits with code 2 and error message", async () => {
    const { startUiServer } = await import("../../src/transport/ui/index.js");
    const mockedStart = vi.mocked(startUiServer);

    const eaddrinuse = Object.assign(new Error("address in use"), {
      code: "EADDRINUSE",
    }) as NodeJS.ErrnoException;
    mockedStart.mockRejectedValue(eaddrinuse);

    const exitCalls: number[] = [];
    const origExit = process.exit.bind(process);
    process.exit = ((code?: number) => {
      exitCalls.push(code ?? 0);
    }) as typeof process.exit;

    try {
      await runUiCommand(["--port=4401"], tmpVault);
    } finally {
      process.exit = origExit;
    }

    expect(exitCalls).toContain(2);
    expect(stderrOutput).toContain("error: port 4401 in use (try --port=...)");
  });

  it("stoa ui --help shows four flags", async () => {
    const { registerUi } = await import("../../src/cli/commands/ui.js");

    const program = new Command();
    program.exitOverride();
    registerUi(program);

    let helpOutput = "";
    program.configureOutput({
      writeOut: (str) => { helpOutput += str; },
      writeErr: (str) => { helpOutput += str; },
    });

    try {
      program.parse(["node", "stoa", "ui", "--help"]);
    } catch {
      // exitOverride throws on --help
    }

    expect(helpOutput).toContain("--port");
    expect(helpOutput).toContain("--bind");
    expect(helpOutput).toContain("--no-open");
  });

  it("buildCli lists ui as a subcommand", async () => {
    const { buildCli } = await import("../../src/cli/index.js");

    // getCtx is already mocked — set a return value for this test
    const { getCtx } = await import("../../src/cli/_ctx.js");
    vi.mocked(getCtx).mockReturnValue({ vaultPath: tmpVault, mcpMode: false });

    const program = buildCli();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("ui");
  });
});
