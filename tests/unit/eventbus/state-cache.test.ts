import { it, expect } from "vitest";
import { StateCache } from "../../../src/core/eventbus/state-cache.js";

it("get returns undefined for unset key", () => {
  const c = new StateCache();
  expect(c.get<string>("task", "_meta", "task-x")).toBeUndefined();
});

it("set then get returns same value", () => {
  const c = new StateCache();
  c.set("task", "_meta", "task-x", { status: "pending" });
  expect(c.get("task", "_meta", "task-x")).toEqual({ status: "pending" });
});

it("different triples do not collide", () => {
  const c = new StateCache();
  c.set("task", "_meta", "task-a", { status: "pending" });
  c.set("task", "_meta", "task-b", { status: "done" });
  c.set("journal", "_meta", "task-a", { status: "archived" });

  expect(c.get("task", "_meta", "task-a")).toEqual({ status: "pending" });
  expect(c.get("task", "_meta", "task-b")).toEqual({ status: "done" });
  expect(c.get("journal", "_meta", "task-a")).toEqual({ status: "archived" });
});

it("has returns false before set, true after", () => {
  const c = new StateCache();
  expect(c.has("task", "_meta", "task-x")).toBe(false);
  c.set("task", "_meta", "task-x", { status: "pending" });
  expect(c.has("task", "_meta", "task-x")).toBe(true);
});

it("size returns correct count", () => {
  const c = new StateCache();
  expect(c.size()).toBe(0);
  c.set("task", "_meta", "task-a", { status: "pending" });
  expect(c.size()).toBe(1);
  c.set("task", "_meta", "task-b", { status: "done" });
  expect(c.size()).toBe(2);
});
