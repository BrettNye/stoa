import { it, expect } from "vitest";
import { makeManyBehavior } from "../../../../src/core/eventbus/kinds/many.js";
import type { VaultEvent } from "../../../../src/core/eventbus/types.js";

const ev = (id: string): VaultEvent => ({
  source: "journal", wiki: "_meta", id, path: `/${id}.md`,
  change_kind: "add", mtime: "2026-05-08T12:00:00.000Z",
});

it("caps accumulator at max", () => {
  const beh = makeManyBehavior(3);
  let s = beh.init([{source: "journal"}], [ev("a"), ev("b"), ev("c"), ev("d")]);
  expect(s.events).toHaveLength(3);
  expect(beh.isSatisfied(s)).toBe(true);
  s = beh.update(s, ev("e"), 0);
  expect(s.events).toHaveLength(3);
});
