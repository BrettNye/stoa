import { it, expect } from "vitest";
import { ColorRule, Theme } from "./theme.js";

it("rejects a color that is not a 3- or 6-digit hex string", () => {
  expect(() =>
    Theme.parse({ name: "x", rules: [{ match: { tag: "recipe" }, color: "red" }] })
  ).toThrow();
});

it("defaults defaultBy to 'wiki' when omitted", () => {
  expect(Theme.parse({ name: "x" }).defaultBy).toBe("wiki");
});

it("accepts a valid 3- or 6-digit hex color", () => {
  expect(() =>
    ColorRule.parse({ match: { tag: "recipe" }, color: "#fff" })
  ).not.toThrow();
  expect(() =>
    ColorRule.parse({ match: { tag: "recipe" }, color: "#a1b2c3" })
  ).not.toThrow();
});
