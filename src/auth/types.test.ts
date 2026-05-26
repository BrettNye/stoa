import { describe, it, expect } from "vitest";
import { ScopeDeniedError, HttpForbiddenError } from "./types.js";

describe("auth types", () => {
  it("ScopeDeniedError carries tool + reason", () => {
    const e = new ScopeDeniedError("vault_new", "wikis/foo/concepts/x");
    expect(e.tool).toBe("vault_new");
    expect(e.reason).toBe("wikis/foo/concepts/x");
    expect(e.name).toBe("ScopeDeniedError");
  });

  it("ScopeDeniedError has correct message", () => {
    const e = new ScopeDeniedError("vault_new", "admin");
    expect(e.message).toBe("scope denied for vault_new: admin");
    expect(e instanceof Error).toBe(true);
  });

  it("HttpForbiddenError carries tool name", () => {
    const e = new HttpForbiddenError("vault_new");
    expect(e.tool).toBe("vault_new");
    expect(e.name).toBe("HttpForbiddenError");
    expect(e.message).toBe("tool vault_new is forbidden over HTTP");
    expect(e instanceof Error).toBe(true);
  });
});
