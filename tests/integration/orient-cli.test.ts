import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { registerOrient } from "../../src/cli/commands/orient.js";

it("registers an `orient` subcommand on the program", () => {
  const program = new Command();
  registerOrient(program);
  const found = program.commands.find((c) => c.name() === "orient");
  expect(found).toBeDefined();
});
