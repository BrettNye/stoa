import { describe, it, expect } from "vitest";
import { buildCli } from "../../src/cli/index.js";
import { allTools } from "../../src/tools/index.js";

it("buildCli registers onboard subcommand", () => {
  const program = buildCli();
  expect(program.commands.find((c) => c.name() === "onboard")).toBeDefined();
});

it("buildCli registers orient subcommand", () => {
  const program = buildCli();
  expect(program.commands.find((c) => c.name() === "orient")).toBeDefined();
});

it("allTools includes vault_orient", () => {
  expect(allTools.find((t) => t.name === "vault_orient")).toBeDefined();
});
