import type { Principal, ToolScope } from "./types.js";
import { HttpForbiddenError, ScopeDeniedError } from "./types.js";
import { matches, hasAdminScope } from "./scope-match.js";

export interface ToolWithScope {
  name: string;
  scope?: ToolScope;
}

export function authorize(tool: ToolWithScope, input: unknown, principal: Principal): void {
  // Gate 1: HTTP-forbidden tools refused over HTTP regardless of scope
  if (principal.source === "http" && tool.scope?.httpForbidden) {
    throw new HttpForbiddenError(tool.name);
  }
  // Tool with no scope metadata fails closed
  if (!tool.scope) {
    throw new ScopeDeniedError(tool.name, "tool missing scope metadata");
  }
  // Gate 2: admin
  const adminRequired = tool.scope.adminOnly?.(input) ?? false;
  if (adminRequired) {
    if (!hasAdminScope(principal.scopes, tool.name)) {
      throw new ScopeDeniedError(tool.name, "admin");
    }
    return;
  }
  // Gate 3: axis
  const axis = tool.scope.axis(input);
  if (!matches(principal.scopes, tool.name, axis)) {
    throw new ScopeDeniedError(tool.name, axis);
  }
}
