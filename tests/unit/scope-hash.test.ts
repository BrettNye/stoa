import { describe, it, expect } from "vitest";
import { scopeHash } from "../../src/core/scope-hash.js";

describe("scopeHash", () => {
  it("is stable across array order within each dimension", () => {
    expect(scopeHash(["a", "b"], [], [], [])).toBe(
      scopeHash(["b", "a"], [], [], []),
    );
    expect(scopeHash([], ["x", "y", "z"], [], [])).toBe(
      scopeHash([], ["z", "x", "y"], [], []),
    );
    expect(scopeHash([], [], ["w1", "w2"], [])).toBe(
      scopeHash([], [], ["w2", "w1"], []),
    );
    expect(scopeHash([], [], [], ["t1", "t2", "t3"])).toBe(
      scopeHash([], [], [], ["t3", "t1", "t2"]),
    );
  });

  it("is membership-sensitive (different sets hash differently)", () => {
    expect(scopeHash(["a", "b"], [], [], [])).not.toBe(
      scopeHash(["a"], [], [], []),
    );
    expect(scopeHash(["a"], ["m"], [], [])).not.toBe(
      scopeHash(["a"], [], [], []),
    );
    expect(scopeHash([], [], ["wiki1"], [])).not.toBe(
      scopeHash([], [], ["wiki2"], []),
    );
    expect(scopeHash([], [], [], ["t1"])).not.toBe(
      scopeHash([], [], [], ["t1", "t2"]),
    );
  });

  it("is deterministic across runs (same inputs always same output)", () => {
    const a = scopeHash(
      ["profile-charmander"],
      ["move-tdd-cycle"],
      ["vault-mcp"],
      ["backend", "tests"],
    );
    const b = scopeHash(
      ["profile-charmander"],
      ["move-tdd-cycle"],
      ["vault-mcp"],
      ["backend", "tests"],
    );
    const c = scopeHash(
      ["profile-charmander"],
      ["move-tdd-cycle"],
      ["vault-mcp"],
      ["backend", "tests"],
    );
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("is dimension-collision-resistant (same value in different dimensions hashes differently)", () => {
    // Same value "a" appearing in different dimensions must not collide.
    expect(scopeHash(["a"], [], [], [])).not.toBe(
      scopeHash([], ["a"], [], []),
    );
    expect(scopeHash([], ["a"], [], [])).not.toBe(
      scopeHash([], [], ["a"], []),
    );
    expect(scopeHash([], [], ["a"], [])).not.toBe(
      scopeHash([], [], [], ["a"]),
    );
    expect(scopeHash(["a"], [], [], [])).not.toBe(
      scopeHash([], [], [], ["a"]),
    );
  });

  it("produces zero collisions across 1000 random scope tuples", () => {
    function rand(n: number): number {
      return Math.floor(Math.random() * n);
    }
    function randStr(): string {
      const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789-";
      const len = 1 + rand(12);
      let s = "";
      for (let i = 0; i < len; i++) {
        s += alphabet[rand(alphabet.length)];
      }
      return s;
    }
    function randList(): string[] {
      const n = rand(5); // 0..4 elements
      const out: string[] = [];
      for (let i = 0; i < n; i++) out.push(randStr());
      return out;
    }

    const seen = new Map<string, [string[], string[], string[], string[]]>();
    let collisions = 0;
    for (let i = 0; i < 1000; i++) {
      const tuple: [string[], string[], string[], string[]] = [
        randList(),
        randList(),
        randList(),
        randList(),
      ];
      const h = scopeHash(...tuple);
      const prev = seen.get(h);
      if (prev) {
        // Compare canonicalized form to distinguish a true collision from
        // accidental duplicate inputs (same set membership across dimensions).
        const canon = (t: typeof tuple) =>
          t.map((arr) => [...arr].sort().join(",")).join("|");
        if (canon(prev) !== canon(tuple)) collisions++;
      } else {
        seen.set(h, tuple);
      }
    }
    expect(collisions).toBe(0);
  });

  it("returns fixed-length lowercase hex output", () => {
    const samples = [
      scopeHash([], [], [], []),
      scopeHash(["a"], [], [], []),
      scopeHash(["a"], ["b"], ["c"], ["d"]),
      scopeHash(["x", "y"], ["m"], ["wiki"], ["tag1", "tag2"]),
      scopeHash(["unicode-ünïcödé"], [], [], []),
    ];
    const expectedLen = samples[0].length;
    for (const h of samples) {
      expect(h).toMatch(/^[0-9a-f]+$/);
      expect(h.length).toBe(expectedLen);
    }
    // Per implementation block, slice(0, 16).
    expect(expectedLen).toBe(16);
  });

  it("does not throw on empty arrays", () => {
    expect(() => scopeHash([], [], [], [])).not.toThrow();
    expect(typeof scopeHash([], [], [], [])).toBe("string");
    // Empty input still yields a fixed-length lowercase hex string.
    expect(scopeHash([], [], [], [])).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not throw on UTF-8 strings", () => {
    expect(() =>
      scopeHash(
        ["プロファイル", "профиль"],
        ["移動", "дзвинок"],
        ["ウィキ"],
        ["étiquette", "🦎🔥"],
      ),
    ).not.toThrow();
    const h = scopeHash(
      ["プロファイル"],
      [],
      [],
      ["🦎🔥"],
    );
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});
