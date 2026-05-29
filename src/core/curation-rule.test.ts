import { it, expect } from "vitest";
import { registerCurationRule, runRegisteredRules, curationRuleRegistry } from "./curation-rule.js";
it("runRegisteredRules flat-maps every registered rule", () => {
  curationRuleRegistry.length = 0;
  registerCurationRule({ code: "X", run: () => [{ code: "X" } as any] });
  registerCurationRule({ code: "Y", run: () => [] });
  expect(runRegisteredRules({} as any).map(a => a.code)).toEqual(["X"]);
});
