import { describe, it, expect } from "vitest";
import { verifyPrMerged } from "./curate-git.js";

describe("verifyPrMerged", () => {
  it("returns unknown when ref has no /pull/<n> segment", () => {
    const runner = () => { throw new Error("should not be called"); };
    expect(verifyPrMerged("github.com/owner/name", runner as never)).toBe("unknown");
  });

  it("returns unknown when gh exits non-zero", () => {
    expect(
      verifyPrMerged("github.com/o/n/pull/9", () => ({ code: 1, stdout: "" }))
    ).toBe("unknown");
  });

  it("returns merged when gh reports MERGED", () => {
    expect(
      verifyPrMerged("github.com/o/n/pull/9", () => ({ code: 0, stdout: "MERGED\n" }))
    ).toBe("merged");
  });

  it("returns open when gh reports OPEN", () => {
    expect(
      verifyPrMerged("github.com/o/n/pull/9", () => ({ code: 0, stdout: "OPEN\n" }))
    ).toBe("open");
  });

  it("returns open when gh reports CLOSED", () => {
    expect(
      verifyPrMerged("github.com/o/n/pull/9", () => ({ code: 0, stdout: "CLOSED\n" }))
    ).toBe("open");
  });

  it("returns unknown when gh reports unrecognized state", () => {
    expect(
      verifyPrMerged("github.com/o/n/pull/9", () => ({ code: 0, stdout: "DRAFT\n" }))
    ).toBe("unknown");
  });

  it("does not shell out when ref has no /pull/<n> segment", () => {
    let called = false;
    verifyPrMerged("github.com/owner/name", () => { called = true; return { code: 0, stdout: "" }; });
    expect(called).toBe(false);
  });
});
