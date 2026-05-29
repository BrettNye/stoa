// Blend a hex color toward a dark background to "dim" it.
// amount 0 = unchanged, 1 = full background. Out-of-range amounts clamp to [0,1].
//
// Only hex input (`#rgb` or `#rrggbb`) is parsed. Any other form (rgb()/rgba()/
// named colors) is not a real input here — palette colors are always hex — so we
// return the background as a safe, visually-correct "fully dimmed" fallback.
export function dimColor(color: string, amount: number, bg = "#0a0a0a"): string {
  const a = Math.min(1, Math.max(0, amount));
  const fg = parseHex(color);
  const back = parseHex(bg);
  if (!fg || !back) return bg;
  const lerp = (c: number, b: number): number => Math.round(c + (b - c) * a);
  const r = lerp(fg[0], back[0]);
  const g = lerp(fg[1], back[1]);
  const b2 = lerp(fg[2], back[2]);
  return `#${toHex(r)}${toHex(g)}${toHex(b2)}`;
}

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}
