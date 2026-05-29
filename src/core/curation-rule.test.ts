import { it, expect, beforeEach } from "vitest";
import { registerCurationRule, runRegisteredRules, curationRuleRegistry } from "./curation-rule.js";
beforeEach(() => { curationRuleRegistry.length = 0; });
it("runRegisteredRules flat-maps every registered rule", () => {
  registerCurationRule({ code: "X", run: () => [{ code: "X" } as any] });
  registerCurationRule({ code: "Y", run: () => [] });
  expect(runRegisteredRules({} as any).map(a => a.code)).toEqual(["X"]);
});
