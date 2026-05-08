import { it, expect } from "vitest";
import { taskMatcher } from "../../../../src/core/eventbus/matchers/task.js";

it("deriveKey returns wiki+id for a task path", () => {
  const k = taskMatcher.deriveKey(
    "/v/wikis/alpha/tasks/task-implement-baz.md", "/v",
  );
  expect(k).toEqual({ wiki: "alpha", id: "task-implement-baz" });
});

it("deriveKey returns null for a non-task path", () => {
  const k = taskMatcher.deriveKey(
    "/v/wikis/alpha/concepts/concept-foo.md", "/v",
  );
  expect(k).toBeNull();
});

it("deriveKey works with backslash-separated paths (Windows)", () => {
  const k = taskMatcher.deriveKey(
    "C:\\Users\\brett\\Documents\\Knowledge\\wikis\\alpha\\tasks\\task-implement-baz.md",
    "C:\\Users\\brett\\Documents\\Knowledge",
  );
  expect(k).toEqual({ wiki: "alpha", id: "task-implement-baz" });
});

it("decide: emit:false when status and owner unchanged", () => {
  const prev = { status: "pending", owner: null };
  const r = taskMatcher.decide(
    { frontmatter: { status: "pending", owner: null }, body: "" }, prev, "change",
  );
  expect(r.emit).toBe(false);
});

it("decide: emit:true with task_status_change when status changes", () => {
  const r = taskMatcher.decide(
    { frontmatter: { status: "in_progress", owner: "agent:c" }, body: "" },
    { status: "pending", owner: null }, "change",
  );
  expect(r.emit).toBe(true);
  expect(r.enrichment?.task_status_change).toEqual({ from: "pending", to: "in_progress" });
  expect(r.enrichment?.task_owner_change).toEqual({ from: null, to: "agent:c" });
});

it("decide: emit:true with only task_owner_change when only owner changes", () => {
  const r = taskMatcher.decide(
    { frontmatter: { status: "in_progress", owner: "agent:b" }, body: "" },
    { status: "in_progress", owner: "agent:a" }, "change",
  );
  expect(r.emit).toBe(true);
  expect(r.enrichment?.task_owner_change).toEqual({ from: "agent:a", to: "agent:b" });
  expect(r.enrichment?.task_status_change).toBeUndefined();
});

it("decide: emit:true with empty enrichment on add with no prev", () => {
  const r = taskMatcher.decide(
    { frontmatter: { status: "pending", owner: null }, body: "" },
    undefined, "add",
  );
  expect(r.emit).toBe(true);
  expect(r.enrichment).toEqual({});
});

it("decide: emit:false on change with no prev", () => {
  const r = taskMatcher.decide(
    { frontmatter: { status: "pending", owner: null }, body: "" },
    undefined, "change",
  );
  expect(r.emit).toBe(false);
});

it("nextState returns current {status, owner} from frontmatter", () => {
  const state = taskMatcher.nextState!(
    { frontmatter: { status: "done", owner: "agent:x" }, body: "" },
  );
  expect(state).toEqual({ status: "done", owner: "agent:x" });
});

it("init returns current {status, owner} from frontmatter", () => {
  const state = taskMatcher.init!(
    "/v/wikis/alpha/tasks/task-foo.md",
    { frontmatter: { status: "accepted", owner: "human:brett" }, body: "" },
  );
  expect(state).toEqual({ status: "accepted", owner: "human:brett" });
});

it("nextState returns empty string for missing status, null for missing owner", () => {
  const state = taskMatcher.nextState!(
    { frontmatter: {}, body: "" },
  );
  expect(state).toEqual({ status: "", owner: null });
});
