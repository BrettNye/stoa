import { it, expect } from "vitest";
import pkg from "../../package.json" with { type: "json" };

it("declares hono, node-server, and open as runtime deps", () => {
  expect(pkg.dependencies.hono).toMatch(/^\^4\./);
  expect(pkg.dependencies["@hono/node-server"]).toMatch(/^\^1\./);
  expect(pkg.dependencies.open).toMatch(/^\^10\./);
});
