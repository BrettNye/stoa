// src/core/lint-checks/claim-scope-wiki-nonexistent.ts
//
// Architectural pattern: factory closure over validWikis. The existing
// registerPerPageRule adapter assumes a stateless rule object; this rule
// needs the wiki set, so we ship a factory and let registration.ts wire it.

import type { PerPageRule, PerPageRuleFinding } from "./per-page-rule.js";

export function makeClaimScopeWikiRule(validWikis: Set<string>): PerPageRule {
  return {
    id: "claim-scope-wiki-nonexistent",
    severity: "warn",
    appliesTo: (page) => page.frontmatter?.type === "claim",
    check: (page): PerPageRuleFinding[] => {
      const fm = page.frontmatter ?? {};
      const scopeWiki = (fm.scope_wiki as string[] | undefined) ?? [];
      const missing = scopeWiki.filter((w) => !validWikis.has(w));
      if (missing.length === 0) return [];
      return [{
        ruleId: "claim-scope-wiki-nonexistent",
        severity: "warn",
        line: 1,
        message: `scope_wiki references missing wiki(s): ${missing.join(", ")} — claim will not surface in those contexts`,
      }];
    },
  };
}
