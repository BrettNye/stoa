import { describe, it, expect } from "vitest";
import { verifyPrMerged } from "./curate-git.js";

describe("verifyPrMerged", () => {
  it("returns unknown when ref has no /pull/<n> segment", () => {
    const runner = (_cmd: string, _args: string[]) => { throw new Error("should not be called"); };
    expect(verifyPrMerged("github.com/owner/name", runner)).toBe("unknown");
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
    verifyPrMerged("github.com/owner/name", (_cmd: string, _args: string[]) => { called = true; return { code: 0, stdout: "" }; });
    expect(called).toBe(false);
  });

  it("passes --repo owner/name to gh so the correct repo is queried", () => {
    let capturedArgs: string[] = [];
    verifyPrMerged("github.com/o/n/pull/9", (_cmd: string, args: string[]) => {
      capturedArgs = args;
      return { code: 0, stdout: "MERGED\n" };
    });
    expect(capturedArgs).toEqual(["pr", "view", "9", "--repo", "o/n", "--json", "state", "-q", ".state"]);
  });

  it("returns unknown when ref has no parseable repo+PR segment", () => {
    const runner = (_cmd: string, _args: string[]) => { throw new Error("should not be called"); };
    expect(verifyPrMerged("not-a-github-ref/pull/99", runner)).toBe("unknown");
  });

  it("does not shell out for no-repo-segment ref", () => {
    const runner = (_cmd: string, _args: string[]) => { throw new Error("should not be called"); };
    expect(verifyPrMerged("github.com/owner/name", runner)).toBe("unknown");
  });
});
