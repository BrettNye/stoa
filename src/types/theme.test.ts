import { it, expect } from "vitest";
import { Theme } from "./theme.js";

it("rejects a malformed color and defaults defaultBy to wiki", () => {
  expect(() => Theme.parse({ name: "x", rules: [{ match: { tag: "recipe" }, color: "red" }] })).toThrow();
  expect(Theme.parse({ name: "x" }).defaultBy).toBe("wiki");
});
