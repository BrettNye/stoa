import picomatch from "picomatch";

export function matches(scopes: string[], tool: string, axis: string): boolean {
  for (const s of scopes) {
    const [prefix, glob = "*"] = s.split(":", 2);
    if (prefix === "*") return true;
    if (prefix === "admin" && picomatch.isMatch(tool, glob)) return true;
    if (prefix !== tool) continue;
    if (picomatch.isMatch(axis, glob)) return true;
  }
  return false;
}

export function hasAdminScope(scopes: string[], tool: string): boolean {
  for (const s of scopes) {
    const [prefix, glob = "*"] = s.split(":", 2);
    if (prefix === "*") return true;
    if (prefix === "admin" && picomatch.isMatch(tool, glob)) return true;
  }
  return false;
}
