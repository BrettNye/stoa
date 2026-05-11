import { describe, it, expect } from "vitest";
import {
  renderBetweenMarkers,
  removeMarkerSection,
  extractBetweenMarkers,
} from "../../src/core/marker-render.js";

describe("renderBetweenMarkers", () => {
  it("appends when markers absent", () => {
    const out = renderBetweenMarkers(
      "# Title\n\nbody",
      "vault-claims",
      "## Learned\n\n- a",
    );
    expect(out).toContain("vault-claims:start");
    expect(out).toContain("## Learned");
    expect(out).toContain("- a");
    expect(out).toContain("vault-claims:end");
    // The original content must be preserved.
    expect(out).toContain("# Title");
    expect(out).toContain("body");
  });

  it("appends without leading separator when content is empty", () => {
    const out = renderBetweenMarkers("", "m", "## Section\n\n- x");
    expect(out.startsWith("<!-- m:start")).toBe(true);
    expect(out).toContain("## Section");
    expect(out).toContain("- x");
    expect(out).toContain("<!-- m:end -->");
  });

  it("appends with single newline when content ends with one newline", () => {
    const base = "alpha\n";
    const out = renderBetweenMarkers(base, "m", "body");
    // Should not introduce excess blank lines beyond a single separator.
    expect(out.startsWith("alpha\n")).toBe(true);
    expect(out).toContain("<!-- m:start -->");
    expect(out).toContain("<!-- m:end -->");
    // Exactly one blank line between original content and the new block.
    expect(out).toMatch(/alpha\n\n<!-- m:start -->/);
  });

  it("appends with no extra newline when content already ends in two newlines", () => {
    const base = "alpha\n\n";
    const out = renderBetweenMarkers(base, "m", "body");
    expect(out).toMatch(/^alpha\n\n<!-- m:start -->/);
  });

  it("replaces idempotently when markers present", () => {
    const start =
      "# Title\n\n<!-- vault-claims:start (rendered: 2026-05-02) -->\n## Learned\n\n- old\n<!-- vault-claims:end -->\n\n## Notes";
    const out = renderBetweenMarkers(
      start,
      "vault-claims",
      "## Learned\n\n- new",
    );
    expect(out).toContain("- new");
    expect(out).not.toContain("- old");
    expect(out).toContain("## Notes");
    expect(out).toContain("# Title");
  });

  it("byte-identical re-render with the same inputs", () => {
    const initial = "# Title\n\nbody";
    const first = renderBetweenMarkers(initial, "m", "## S\n\n- a", {
      renderedDate: "2026-05-03",
      halfLifeDays: 14,
    });
    const second = renderBetweenMarkers(first, "m", "## S\n\n- a", {
      renderedDate: "2026-05-03",
      halfLifeDays: 14,
    });
    expect(second).toBe(first);
    // And a third pass for paranoia.
    const third = renderBetweenMarkers(second, "m", "## S\n\n- a", {
      renderedDate: "2026-05-03",
      halfLifeDays: 14,
    });
    expect(third).toBe(second);
  });

  it("includes (rendered: <date>, half-life: <N>d) when both options passed", () => {
    const out = renderBetweenMarkers("base", "m", "x", {
      renderedDate: "2026-05-03",
      halfLifeDays: 14,
    });
    expect(out).toContain("<!-- m:start (rendered: 2026-05-03, half-life: 14d) -->");
  });

  it("includes only (rendered: <date>) when halfLifeDays absent", () => {
    const out = renderBetweenMarkers("base", "m", "x", {
      renderedDate: "2026-05-03",
    });
    expect(out).toContain("<!-- m:start (rendered: 2026-05-03) -->");
    expect(out).not.toContain("half-life");
  });

  it("includes only (half-life: <N>d) when renderedDate absent", () => {
    const out = renderBetweenMarkers("base", "m", "x", {
      halfLifeDays: 30,
    });
    expect(out).toContain("<!-- m:start (half-life: 30d) -->");
    expect(out).not.toContain("rendered:");
  });

  it("emits no parenthetical when neither option passed", () => {
    const out = renderBetweenMarkers("base", "m", "x");
    expect(out).toContain("<!-- m:start -->");
    expect(out).not.toContain("(rendered");
    expect(out).not.toContain("(half-life");
  });

  it("preserves content outside the markers exactly when replacing", () => {
    const before = "PREFIX_LINE_1\nPREFIX_LINE_2\n\n";
    const between =
      "<!-- m:start (rendered: 2026-05-01) -->\nold body\n<!-- m:end -->";
    const after = "\n\nSUFFIX_LINE_1\nSUFFIX_LINE_2\n";
    const start = before + between + after;
    const out = renderBetweenMarkers(start, "m", "new body");
    expect(out.startsWith(before)).toBe(true);
    expect(out.endsWith(after)).toBe(true);
    expect(out).toContain("new body");
    expect(out).not.toContain("old body");
  });

  it("different markerName values do not interact", () => {
    const start =
      "head\n\n<!-- vault-claims:start -->\nclaims body\n<!-- vault-claims:end -->\n\n<!-- vault-claims-profile:start -->\nprofile body\n<!-- vault-claims-profile:end -->\n\ntail";
    // Replace only vault-claims; vault-claims-profile must be untouched.
    const out = renderBetweenMarkers(start, "vault-claims", "NEW CLAIMS");
    expect(out).toContain("NEW CLAIMS");
    expect(out).not.toContain("claims body");
    expect(out).toContain("profile body");
    expect(out).toContain("vault-claims-profile:start");
    expect(out).toContain("vault-claims-profile:end");
    expect(out).toContain("head");
    expect(out).toContain("tail");
  });

  it("with two start blocks of the same name, replaces only the first pair", () => {
    // A human-edited file might accidentally contain duplicate marker
    // sections. Spec choice: replace the FIRST start..end pair, leave the
    // second pair intact. This is well-defined and avoids garbled slices.
    const start =
      "head\n\n<!-- m:start -->\nFIRST OLD\n<!-- m:end -->\n\nmid\n\n<!-- m:start -->\nSECOND OLD\n<!-- m:end -->\n\ntail";
    const out = renderBetweenMarkers(start, "m", "NEW BODY");
    expect(out).toContain("NEW BODY");
    expect(out).not.toContain("FIRST OLD");
    // Second marker block must remain intact.
    expect(out).toContain("SECOND OLD");
    expect(out).toContain("head");
    expect(out).toContain("mid");
    expect(out).toContain("tail");
  });

  it("throws a descriptive error when start marker is present but end marker is missing", () => {
    const start = "head\n\n<!-- m:start -->\norphan body\n\ntail";
    expect(() => renderBetweenMarkers(start, "m", "NEW")).toThrow(
      /m:end/,
    );
  });
});

describe("removeMarkerSection", () => {
  it("removes the marker-bounded region (including markers)", () => {
    const start =
      "before\n\n<!-- m:start (rendered: 2026-05-02) -->\nbody\n<!-- m:end -->\n\nafter";
    const out = removeMarkerSection(start, "m");
    expect(out).not.toContain("m:start");
    expect(out).not.toContain("m:end");
    expect(out).not.toContain("body");
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("collapses surrounding blank lines after removal", () => {
    const start =
      "before\n\n<!-- m:start -->\nbody\n<!-- m:end -->\n\nafter";
    const out = removeMarkerSection(start, "m");
    // Should not leave a double blank gap where the section used to be.
    expect(out).not.toMatch(/\n\n\n/);
    expect(out).toContain("before");
    expect(out).toContain("after");
  });

  it("is a no-op when markers are absent", () => {
    const base = "no markers here\n\njust prose";
    expect(removeMarkerSection(base, "m")).toBe(base);
  });

  it("does not touch other marker sections with different names", () => {
    const start =
      "head\n\n<!-- vault-claims:start -->\nclaims body\n<!-- vault-claims:end -->\n\n<!-- vault-claims-profile:start -->\nprofile body\n<!-- vault-claims-profile:end -->\n\ntail";
    const out = removeMarkerSection(start, "vault-claims");
    expect(out).not.toContain("claims body");
    expect(out).not.toContain("vault-claims:start");
    expect(out).not.toContain("vault-claims:end");
    expect(out).toContain("profile body");
    expect(out).toContain("vault-claims-profile:start");
    expect(out).toContain("vault-claims-profile:end");
  });

  it("with two start blocks of the same name, removes only the first pair", () => {
    const start =
      "head\n\n<!-- m:start -->\nFIRST\n<!-- m:end -->\n\nmid\n\n<!-- m:start -->\nSECOND\n<!-- m:end -->\n\ntail";
    const out = removeMarkerSection(start, "m");
    expect(out).not.toContain("FIRST");
    // Second pair survives.
    expect(out).toContain("SECOND");
    expect(out).toContain("head");
    expect(out).toContain("mid");
    expect(out).toContain("tail");
  });

  it("throws a descriptive error when start marker is present but end marker is missing", () => {
    const start = "head\n\n<!-- m:start -->\norphan body\n\ntail";
    expect(() => removeMarkerSection(start, "m")).toThrow(/m:end/);
  });

  it("round-trip: render then remove returns close-to-original (modulo trailing newlines)", () => {
    const original = "# Title\n\nbody\n";
    const rendered = renderBetweenMarkers(original, "m", "## S\n\n- a", {
      renderedDate: "2026-05-03",
    });
    const removed = removeMarkerSection(rendered, "m");
    expect(removed).toContain("# Title");
    expect(removed).toContain("body");
    expect(removed).not.toContain("m:start");
    expect(removed).not.toContain("m:end");
    expect(removed).not.toContain("## S");
  });
});

describe("extractBetweenMarkers", () => {
  it("returns the content between markers, exclusive of the markers themselves", () => {
    const content =
      "head\n\n<!-- m:start -->\nbody line 1\nbody line 2\n<!-- m:end -->\n\ntail";
    const out = extractBetweenMarkers(content, "m");
    expect(out).toBe("body line 1\nbody line 2");
  });

  it("returns null when start marker is absent", () => {
    expect(extractBetweenMarkers("no markers here", "m")).toBeNull();
  });

  it("returns an empty string when the region between markers is empty", () => {
    // Adjacent markers with nothing but a newline between them.
    const content = "head\n\n<!-- m:start -->\n<!-- m:end -->\n\ntail";
    const out = extractBetweenMarkers(content, "m");
    expect(out).toBe("");
  });

  it("preserves embedded HTML comments and inner whitespace verbatim", () => {
    const inner = "  <!-- this is fine -->\n\n  indented line\n";
    const content = `head\n<!-- m:start -->\n${inner}<!-- m:end -->\ntail`;
    const out = extractBetweenMarkers(content, "m");
    // Trailing newline before the end marker is stripped; everything else
    // preserved.
    expect(out).toBe(inner.replace(/\n$/, ""));
  });

  it("tolerates start-marker parenthetical metadata", () => {
    const content =
      "head\n\n<!-- m:start (rendered: 2026-05-11) -->\nbody\n<!-- m:end -->\n\ntail";
    expect(extractBetweenMarkers(content, "m")).toBe("body");
  });

  it("does not match a different marker name", () => {
    const content =
      "head\n<!-- vault-claims:start -->\nclaims body\n<!-- vault-claims:end -->\ntail";
    expect(extractBetweenMarkers(content, "vault-synthesize-manual")).toBeNull();
  });

  it("with two start blocks of the same name, returns content of the FIRST pair", () => {
    const content =
      "head\n<!-- m:start -->\nFIRST\n<!-- m:end -->\nmid\n<!-- m:start -->\nSECOND\n<!-- m:end -->\ntail";
    expect(extractBetweenMarkers(content, "m")).toBe("FIRST");
  });

  it("throws a descriptive error when start marker is present but end marker is missing", () => {
    const content = "head\n<!-- m:start -->\norphan body\ntail";
    expect(() => extractBetweenMarkers(content, "m")).toThrow(/m:end/);
  });

  it("round-trip: render then extract returns the body that was rendered", () => {
    const original = "# Title\n\nbody";
    const body = "user wrote this";
    const rendered = renderBetweenMarkers(original, "vault-synthesize-manual", body);
    expect(extractBetweenMarkers(rendered, "vault-synthesize-manual")).toBe(body);
  });
});
