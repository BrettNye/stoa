import { it, expect } from "vitest";
import { gateActions } from "./curation-gate.js";
import type { CurationAction } from "./curation-rule.js";
import type { CurationConfig } from "../config.js";

const cfg: CurationConfig = {
  confidence_floor: "medium",
  auto_archive_human: false,
  archive_stale_days: 60,
  promote_active_recent_days: 14,
  auto_commit: true,
};

function action(overrides: Partial<CurationAction>): CurationAction {
  return {
    code: "test-rule",
    page_id: "concept-example",
    wiki: "test-wiki",
    from_status: "draft",
    to_status: "active",
    evidence: "test evidence",
    confidence: "high",
    author_class: "agent",
    applies: false, // rule placeholder — gate MUST overwrite
    ...overrides,
  };
}

// ── confidence floor ──────────────────────────────────────────────────────────

it("holds back action below confidence floor (low < medium)", () => {
  const [a] = gateActions([action({ confidence: "low" })], cfg);
  expect(a.applies).toBe(false);
  expect(a.flag_reason).toMatch(/below confidence floor/);
  expect(a.flag_reason).toMatch(/low/);
});

it("allows action at the confidence floor exactly (medium = medium)", () => {
  const [a] = gateActions([action({ confidence: "medium" })], cfg);
  expect(a.applies).toBe(true);
});

it("allows action above the confidence floor (high > medium)", () => {
  const [a] = gateActions([action({ confidence: "high" })], cfg);
  expect(a.applies).toBe(true);
});

it("holds back action below a high confidence floor", () => {
  const highCfg: CurationConfig = { ...cfg, confidence_floor: "high" };
  const [a] = gateActions([action({ confidence: "medium" })], highCfg);
  expect(a.applies).toBe(false);
  expect(a.flag_reason).toMatch(/below confidence floor/);
});

// ── human-archive scope rule ──────────────────────────────────────────────────

it("holds back human-authored archive when auto_archive_human is false", () => {
  const [a] = gateActions(
    [action({ to_status: "archived", author_class: "human", confidence: "high" })],
    cfg
  );
  expect(a.applies).toBe(false);
  expect(a.flag_reason).toMatch(/human-authored/);
});

it("allows human-authored archive when auto_archive_human is true", () => {
  const autoCfg: CurationConfig = { ...cfg, auto_archive_human: true };
  const [a] = gateActions(
    [action({ to_status: "archived", author_class: "human", confidence: "high" })],
    autoCfg
  );
  expect(a.applies).toBe(true);
});

it("allows agent-authored archive regardless of auto_archive_human setting", () => {
  const [a] = gateActions(
    [action({ to_status: "archived", author_class: "agent", confidence: "high" })],
    cfg
  );
  expect(a.applies).toBe(true);
});

// ── rule-set flag_reason hold-back ────────────────────────────────────────────

it("preserves applies:false for action that already has a rule-set flag_reason", () => {
  const [a] = gateActions(
    [action({ flag_reason: "rule detected conflict" })],
    cfg
  );
  expect(a.applies).toBe(false);
  expect(a.flag_reason).toBe("rule detected conflict");
});

it("does not overwrite rule flag_reason with gate's own flag_reason", () => {
  const [a] = gateActions(
    [action({ confidence: "low", flag_reason: "rule: already held back" })],
    cfg
  );
  // Rule flag_reason takes precedence; gate does not add another flag_reason
  expect(a.applies).toBe(false);
  expect(a.flag_reason).toBe("rule: already held back");
});

// ── gate overwrites incoming applies placeholder ───────────────────────────────

it("overwrites incoming applies:false placeholder to applies:true when action clears all gates", () => {
  // Rule emitted applies:false as a placeholder — gate MUST ignore it and set true
  const incoming = action({ applies: false, confidence: "high", author_class: "agent", to_status: "active" });
  expect(incoming.applies).toBe(false); // confirm placeholder is false before gate
  const [a] = gateActions([incoming], cfg);
  expect(a.applies).toBe(true);
});

// ── agent-authored promotions ─────────────────────────────────────────────────

it("applies agent-authored promotion that clears the floor", () => {
  const [a] = gateActions(
    [action({ to_status: "accepted", author_class: "agent", confidence: "high" })],
    cfg
  );
  expect(a.applies).toBe(true);
});

// ── multiple actions processed independently ──────────────────────────────────

it("processes multiple actions independently", () => {
  const actions: CurationAction[] = [
    action({ confidence: "high", page_id: "p1" }),
    action({ confidence: "low", page_id: "p2" }),
    action({ to_status: "archived", author_class: "human", confidence: "high", page_id: "p3" }),
  ];
  const result = gateActions(actions, cfg);
  expect(result[0].applies).toBe(true);
  expect(result[1].applies).toBe(false);
  expect(result[2].applies).toBe(false);
});

// ── return value is a fresh array (non-mutating) ──────────────────────────────

it("returns a new array without mutating the input", () => {
  const original = action({ confidence: "high" });
  const input = [original];
  const result = gateActions(input, cfg);
  expect(result).not.toBe(input);
  // original object should not be mutated
  expect(original.applies).toBe(false); // still the placeholder
});
