import { describe, it, expect } from "vitest";

describe("chokidar availability", () => {
  it("chokidar imports cleanly", async () => {
    const chokidar = await import("chokidar");
    expect(typeof chokidar.watch).toBe("function");
  });
});
