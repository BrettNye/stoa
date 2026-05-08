import { it, expect } from "vitest";
import { EventDeriver } from "../../../src/core/eventbus/event-deriver.js";
import { EventBus } from "../../../src/core/eventbus/bus.js";
import { StateCache } from "../../../src/core/eventbus/state-cache.js";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeVault(): string {
  return mkdtempSync(join(tmpdir(), "stoa-d-"));
}

function makeDeriver(vault: string, bus: EventBus, stateCache?: StateCache) {
  return new EventDeriver({
    vaultPath: vault,
    bus,
    stateCache: stateCache ?? new StateCache(),
  });
}

// --- Journal matcher ---

it("emits a journal event with channel enrichment", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "journal"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "journal", "journal-x.md");
  writeFileSync(
    fp,
    "---\nid: journal-x\ntype: journal\nchannel: duel-x\ncreated: 2026-05-08\n---\n",
  );
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const d = makeDeriver(vault, bus);
  d.derive(fp, "add");
  expect(seen).toHaveLength(1);
  expect(seen[0].source).toBe("journal");
  expect(seen[0].channel).toBe("duel-x");
});

it("emits a journal event without channel when channel not in frontmatter", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "myproject", "journal"), { recursive: true });
  const fp = join(vault, "wikis", "myproject", "journal", "journal-y.md");
  writeFileSync(
    fp,
    "---\nid: journal-y\ntype: journal\ncreated: 2026-05-08\n---\n",
  );
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const d = makeDeriver(vault, bus);
  d.derive(fp, "add");
  expect(seen).toHaveLength(1);
  expect(seen[0].source).toBe("journal");
  expect(seen[0].channel).toBeUndefined();
});

// --- Path not matching any matcher ---

it("silently drops paths not matching any matcher", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "concepts"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "concepts", "concept-foo.md");
  writeFileSync(fp, "---\nid: concept-foo\ntype: concept\ncreated: 2026-05-08\n---\n");
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const d = makeDeriver(vault, bus);
  d.derive(fp, "add");
  expect(seen).toHaveLength(0);
});

// --- Frontmatter parse error ---

it("invokes onParseError and skips emit when frontmatter is missing", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "journal"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "journal", "journal-broken.md");
  writeFileSync(fp, "no frontmatter at all");
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const errors: [string, unknown][] = [];
  const d = new EventDeriver({
    vaultPath: vault,
    bus,
    stateCache: new StateCache(),
    onParseError: (path, err) => errors.push([path, err]),
  });
  d.derive(fp, "add");
  expect(seen).toHaveLength(0);
  expect(errors).toHaveLength(1);
  expect(errors[0][0]).toBe(fp);
});

it("skips emit gracefully even with no onParseError callback provided", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "journal"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "journal", "journal-broken2.md");
  writeFileSync(fp, "no frontmatter");
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const d = makeDeriver(vault, bus);
  expect(() => d.derive(fp, "add")).not.toThrow();
  expect(seen).toHaveLength(0);
});

// --- ENOENT handling ---

it("silently swallows ENOENT when file does not exist", () => {
  const vault = makeVault();
  const fp = join(vault, "wikis", "_meta", "journal", "journal-nonexistent.md");
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const errors: [string, unknown][] = [];
  const d = new EventDeriver({
    vaultPath: vault,
    bus,
    stateCache: new StateCache(),
    onParseError: (path, err) => errors.push([path, err]),
  });
  expect(() => d.derive(fp, "add")).not.toThrow();
  expect(seen).toHaveLength(0);
  expect(errors).toHaveLength(0); // ENOENT is NOT passed to onParseError
});

// --- Task matcher: state cache and enrichment ---

it("emits task event on add with no prev state", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "tasks"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "tasks", "task-alpha.md");
  writeFileSync(
    fp,
    "---\nid: task-alpha\ntype: task\nstatus: pending\ncreated: 2026-05-08\n---\n",
  );
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const d = makeDeriver(vault, bus);
  d.derive(fp, "add");
  expect(seen).toHaveLength(1);
  expect(seen[0].source).toBe("task");
  expect(seen[0].id).toBe("task-alpha");
});

it("updates state cache even when decide returns emit:false", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "tasks"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "tasks", "task-beta.md");
  writeFileSync(
    fp,
    "---\nid: task-beta\ntype: task\nstatus: pending\ncreated: 2026-05-08\n---\n",
  );
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const sc = new StateCache();
  // Pre-seed state so decide returns emit:false (same status/owner)
  sc.set("task", "_meta", "task-beta", { status: "pending", owner: null });
  const d = makeDeriver(vault, bus, sc);
  d.derive(fp, "change");
  expect(seen).toHaveLength(0); // no change → no emit
  // State cache should still be updated
  expect(sc.has("task", "_meta", "task-beta")).toBe(true);
  const state = sc.get<{ status: string; owner: string | null }>("task", "_meta", "task-beta");
  expect(state?.status).toBe("pending");
});

it("emits task_status_change when status changes", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "tasks"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "tasks", "task-gamma.md");
  writeFileSync(
    fp,
    "---\nid: task-gamma\ntype: task\nstatus: active\ncreated: 2026-05-08\n---\n",
  );
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const sc = new StateCache();
  // Prev state has status "pending"
  sc.set("task", "_meta", "task-gamma", { status: "pending", owner: null });
  const d = makeDeriver(vault, bus, sc);
  d.derive(fp, "change");
  expect(seen).toHaveLength(1);
  expect(seen[0].task_status_change).toEqual({ from: "pending", to: "active" });
});

it("emits task_owner_change when owner changes", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "tasks"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "tasks", "task-delta.md");
  writeFileSync(
    fp,
    "---\nid: task-delta\ntype: task\nstatus: active\nowner: agent:pidgey\ncreated: 2026-05-08\n---\n",
  );
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const sc = new StateCache();
  sc.set("task", "_meta", "task-delta", { status: "active", owner: null });
  const d = makeDeriver(vault, bus, sc);
  d.derive(fp, "change");
  expect(seen).toHaveLength(1);
  expect(seen[0].task_owner_change).toEqual({ from: null, to: "agent:pidgey" });
});

// --- VaultEvent shape ---

it("emitted event has correct base fields", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "journal"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "journal", "journal-shape.md");
  writeFileSync(
    fp,
    "---\nid: journal-shape\ntype: journal\ncreated: 2026-05-08\n---\n",
  );
  const bus = new EventBus();
  const seen: any[] = [];
  bus.subscribe((e) => seen.push(e));
  const d = makeDeriver(vault, bus);
  d.derive(fp, "add");
  expect(seen[0]).toMatchObject({
    source: "journal",
    wiki: "_meta",
    id: "journal-shape",
    path: fp,
    change_kind: "add",
  });
  expect(typeof seen[0].mtime).toBe("string");
});

// --- warmStateCache ---

it("warmStateCache populates state cache for matchers with init defined", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "tasks"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "tasks", "task-warm.md");
  writeFileSync(
    fp,
    "---\nid: task-warm\ntype: task\nstatus: accepted\ncreated: 2026-05-08\n---\n",
  );
  const sc = new StateCache();
  const bus = new EventBus();
  const d = makeDeriver(vault, bus, sc);
  d.warmStateCache([fp]);
  expect(sc.has("task", "_meta", "task-warm")).toBe(true);
  const state = sc.get<{ status: string; owner: string | null }>("task", "_meta", "task-warm");
  expect(state?.status).toBe("accepted");
});

it("warmStateCache skips files with parse errors gracefully", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "tasks"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "tasks", "task-warm-bad.md");
  writeFileSync(fp, "no frontmatter");
  const sc = new StateCache();
  const bus = new EventBus();
  const d = makeDeriver(vault, bus, sc);
  expect(() => d.warmStateCache([fp])).not.toThrow();
  expect(sc.has("task", "_meta", "task-warm-bad")).toBe(false);
});

it("warmStateCache ignores files not matching any matcher", () => {
  const vault = makeVault();
  mkdirSync(join(vault, "wikis", "_meta", "concepts"), { recursive: true });
  const fp = join(vault, "wikis", "_meta", "concepts", "concept-warm.md");
  writeFileSync(fp, "---\nid: concept-warm\ntype: concept\ncreated: 2026-05-08\n---\n");
  const sc = new StateCache();
  const bus = new EventBus();
  const d = makeDeriver(vault, bus, sc);
  d.warmStateCache([fp]);
  expect(sc.size()).toBe(0);
});
