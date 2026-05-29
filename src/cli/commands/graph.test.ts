import { it, expect, vi, beforeEach, describe } from "vitest";
vi.mock("open", () => ({ default: vi.fn(async () => undefined) }));
vi.mock("../../config.js", () => ({
  loadVaultStoaConfig: vi.fn(() => ({ bind: "127.0.0.1:8443" })),
}));
import open from "open";
import { loadVaultStoaConfig } from "../../config.js";
import { Command } from "commander";
import { registerGraph } from "./graph.js";

const openMock = open as unknown as ReturnType<typeof vi.fn>;
const loadConfigMock = loadVaultStoaConfig as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  loadConfigMock.mockReturnValue({ bind: "127.0.0.1:8443" });
});

it("registers a graph command that opens the viewer URL", async () => {
  const program = new Command();
  registerGraph(program);
  await program.parseAsync(["node", "stoa", "graph"]);
  expect(openMock).toHaveBeenCalledTimes(1);
  expect(openMock.mock.calls[0][0]).toMatch(/\/graph$/);
});

it("opens a URL derived from the stoa bind config", async () => {
  const program = new Command();
  registerGraph(program);
  await program.parseAsync(["node", "stoa", "graph"]);
  expect(openMock).toHaveBeenCalledTimes(1);
  const url: string = openMock.mock.calls[0][0];
  expect(url).toMatch(/^http:\/\//);
  expect(url).toMatch(/\/graph$/);
});

it("prints a hint to run stoa serve", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const program = new Command();
  registerGraph(program);
  await program.parseAsync(["node", "stoa", "graph"]);
  const printed = logSpy.mock.calls.flat().join(" ");
  expect(printed).toMatch(/stoa serve/);
  logSpy.mockRestore();
});

describe("0.0.0.0 bind address substitution", () => {
  it("substitutes 0.0.0.0 with 127.0.0.1 in the opened URL", async () => {
    loadConfigMock.mockReturnValue({ bind: "0.0.0.0:8443" });
    const program = new Command();
    registerGraph(program);
    await program.parseAsync(["node", "stoa", "graph"]);
    expect(openMock).toHaveBeenCalledTimes(1);
    const url: string = openMock.mock.calls[0][0];
    expect(url).toBe("http://127.0.0.1:8443/graph");
  });

  it("substitutes bare 0.0.0.0 (no port) with 127.0.0.1", async () => {
    loadConfigMock.mockReturnValue({ bind: "0.0.0.0" });
    const program = new Command();
    registerGraph(program);
    await program.parseAsync(["node", "stoa", "graph"]);
    expect(openMock).toHaveBeenCalledTimes(1);
    const url: string = openMock.mock.calls[0][0];
    expect(url).toBe("http://127.0.0.1/graph");
  });

  it("leaves a normal bind address unchanged", async () => {
    loadConfigMock.mockReturnValue({ bind: "192.168.1.10:9000" });
    const program = new Command();
    registerGraph(program);
    await program.parseAsync(["node", "stoa", "graph"]);
    expect(openMock).toHaveBeenCalledTimes(1);
    const url: string = openMock.mock.calls[0][0];
    expect(url).toBe("http://192.168.1.10:9000/graph");
  });
});

it("writes to stderr and exits non-zero when loadVaultStoaConfig throws", async () => {
  loadConfigMock.mockImplementation(() => {
    throw new Error("config not found");
  });
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as any);
  const program = new Command();
  registerGraph(program);
  await program.parseAsync(["node", "stoa", "graph"]);
  expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("config not found"));
  expect(exitSpy).toHaveBeenCalledWith(2);
  stderrSpy.mockRestore();
  exitSpy.mockRestore();
});
