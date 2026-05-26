import { it, expect, vi } from "vitest";
vi.mock("open", () => ({ default: vi.fn(async () => undefined) }));
import open from "open";
import { Command } from "commander";
import { registerGraph } from "./graph.js";

it("registers a graph command that opens the viewer URL", async () => {
  const program = new Command();
  registerGraph(program);
  await program.parseAsync(["node", "stoa", "graph"]);
  expect((open as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/\/graph$/);
});

it("opens a URL derived from the stoa bind config", async () => {
  vi.clearAllMocks();
  const program = new Command();
  registerGraph(program);
  await program.parseAsync(["node", "stoa", "graph"]);
  const url: string = (open as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(url).toMatch(/^http:\/\//);
  expect(url).toMatch(/\/graph$/);
});

it("prints a hint to run stoa serve", async () => {
  vi.clearAllMocks();
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const program = new Command();
  registerGraph(program);
  await program.parseAsync(["node", "stoa", "graph"]);
  const printed = logSpy.mock.calls.flat().join(" ");
  expect(printed).toMatch(/stoa serve/);
  logSpy.mockRestore();
});
