import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import { registerServeCommand } from "./serve.js";

describe("serve CLI", () => {
  let originalVaultPath: string | undefined;
  let originalExit: typeof process.exit;
  let originalStderrWrite: typeof process.stderr.write;
  let exitCode: number | undefined;
  let stderrCaptured: string;

  beforeEach(() => {
    originalVaultPath = process.env.STOA_VAULT_PATH;
    delete process.env.STOA_VAULT_PATH;
    originalExit = process.exit;
    process.exit = ((code?: number) => { exitCode = code; throw new Error("__exit__"); }) as any;
    stderrCaptured = "";
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: any) => { stderrCaptured += chunk; return true; }) as any;
    exitCode = undefined;
  });
  afterEach(() => {
    process.exit = originalExit;
    process.stderr.write = originalStderrWrite;
    if (originalVaultPath === undefined) delete process.env.STOA_VAULT_PATH;
    else process.env.STOA_VAULT_PATH = originalVaultPath;
  });

  it("exits 2 when no vault path provided", async () => {
    const program = new Command();
    registerServeCommand(program);
    try {
      await program.parseAsync(["node", "stoa", "serve"]);
    } catch (e: any) {
      if (e.message !== "__exit__") throw e;
    }
    expect(exitCode).toBe(2);
    expect(stderrCaptured).toMatch(/vault/);
  });

  it("registers the serve command on the program", () => {
    const program = new Command();
    registerServeCommand(program);
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("serve");
  });

  it("serve command has --bind and --vault options", () => {
    const program = new Command();
    registerServeCommand(program);
    const serveCmd = program.commands.find((c) => c.name() === "serve")!;
    const optionNames = serveCmd.options.map((o) => o.long);
    expect(optionNames).toContain("--bind");
    expect(optionNames).toContain("--vault");
  });
});
