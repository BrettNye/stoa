/**
 * Pure helpers for idempotent, marker-bounded section rendering inside a
 * markdown document. Used by `synthesize` (claims rollup), and by
 * `sync-skills` and `bootstrap-repo` (skill / agent doc patches) — anywhere
 * a tool needs to maintain a managed region inside a file that humans may
 * also edit.
 *
 * Contract:
 * - The managed region is bounded by `<!-- <name>:start ... -->` and
 *   `<!-- <name>:end -->` HTML comments.
 * - Re-rendering with the same inputs produces byte-identical output.
 * - Different `markerName` values are independent; one section can be
 *   rendered or removed without disturbing another in the same file.
 */

export interface MarkerOptions {
  /** ISO date YYYY-MM-DD; included in the start marker for display. */
  renderedDate?: string;
  /** Half-life in days; included in the start marker for display. */
  halfLifeDays?: number;
}

/**
 * Replace the content between `<!-- markerName:start ... -->` and
 * `<!-- markerName:end -->` with `replacement`. If the markers are absent,
 * append the new section at the end of `content` (with a leading blank
 * line if `content` is non-empty).
 *
 * The start marker carries metadata `(rendered: <date>, half-life: <N>d)`
 * when those options are passed; otherwise no parenthetical is emitted.
 * The end marker is plain.
 *
 * `replacement` is the section body — the markers themselves are added by
 * this function. The caller passes the section heading and bullets; this
 * function bounds them.
 *
 * Locates the FIRST `start` marker via `RegExp.exec()` (deterministic
 * position) and searches for the matching `end` marker only in the
 * substring after the start marker, so duplicate or out-of-order markers
 * cannot produce a crossed/garbled slice. Throws a descriptive Error when
 * a start marker is found but no end marker follows it — markers are a
 * structured contract per the spec, and silent fallback would mask file
 * corruption.
 */
export function renderBetweenMarkers(
  content: string,
  markerName: string,
  replacement: string,
  opts: MarkerOptions = {},
): string {
  const escaped = escapeRegex(markerName);
  const startMarkerRe = new RegExp(`<!--\\s*${escaped}:start[^>]*-->`);
  const endMarkerRe = new RegExp(`<!--\\s*${escaped}:end\\s*-->`);

  const dateClause = opts.renderedDate ? `rendered: ${opts.renderedDate}` : "";
  const halfClause = opts.halfLifeDays ? `half-life: ${opts.halfLifeDays}d` : "";
  const meta = [dateClause, halfClause].filter(Boolean).join(", ");
  const startMarker = meta
    ? `<!-- ${markerName}:start (${meta}) -->`
    : `<!-- ${markerName}:start -->`;
  const endMarker = `<!-- ${markerName}:end -->`;

  const block = `${startMarker}\n${replacement.trimEnd()}\n${endMarker}`;

  const startExec = startMarkerRe.exec(content);
  if (startExec) {
    const startIdx = startExec.index;
    const afterStart = startIdx + startExec[0].length;
    const endExec = endMarkerRe.exec(content.slice(afterStart));
    if (!endExec) {
      throw new Error(
        `renderBetweenMarkers: found <!-- ${markerName}:start --> at offset ${startIdx} but no matching <!-- ${markerName}:end --> after it`,
      );
    }
    const endIdx = afterStart + endExec.index + endExec[0].length;
    return content.slice(0, startIdx) + block + content.slice(endIdx);
  }

  // Markers absent — append.
  if (content.length === 0) {
    return block + "\n";
  }
  const sep = content.endsWith("\n\n")
    ? ""
    : content.endsWith("\n")
      ? "\n"
      : "\n\n";
  return content + sep + block + "\n";
}

/**
 * Remove a marker-bounded section entirely (used for opt-out cleanup —
 * §8.2 behavior: when `claim_render: false` is set on a previously-rendered
 * move, sync-skills removes the existing markers + content).
 *
 * Surrounding blank lines are collapsed so removal does not leave a visible
 * gap. If neither marker is present, returns `content` unchanged. If a
 * start marker is found but no end marker follows it, throws a descriptive
 * Error — markers are a structured contract per the spec, and silent
 * fallback would mask file corruption. Searches for the end marker only
 * after the start marker, so duplicate / out-of-order markers cannot
 * produce a crossed slice.
 */
export function removeMarkerSection(content: string, markerName: string): string {
  const escaped = escapeRegex(markerName);
  const startMarkerRe = new RegExp(`<!--\\s*${escaped}:start[^>]*-->`);
  const endMarkerRe = new RegExp(`<!--\\s*${escaped}:end\\s*-->`);
  const startExec = startMarkerRe.exec(content);
  if (!startExec) return content;
  const startIdx = startExec.index;
  const afterStart = startIdx + startExec[0].length;
  const endExec = endMarkerRe.exec(content.slice(afterStart));
  if (!endExec) {
    throw new Error(
      `removeMarkerSection: found <!-- ${markerName}:start --> at offset ${startIdx} but no matching <!-- ${markerName}:end --> after it`,
    );
  }
  const endIdx = afterStart + endExec.index + endExec[0].length;
  const before = content.slice(0, startIdx).replace(/\n+$/, "\n");
  const after = content.slice(endIdx).replace(/^\n+/, "\n");
  return before + after;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
