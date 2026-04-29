import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class WikiRequiredError extends Error {
  constructor() {
    super("no wiki specified, no --default-wiki set, no .active-wiki file");
    this.name = "WikiRequiredError";
  }
}

export function resolveWiki(
  argWiki: string | undefined,
  defaultWiki: string | undefined,
  vaultPath: string
): string {
  if (argWiki) return argWiki;
  if (defaultWiki) return defaultWiki;
  const activePath = join(vaultPath, ".active-wiki");
  if (existsSync(activePath)) {
    const v = readFileSync(activePath, "utf8").trim();
    if (v) return v;
  }
  throw new WikiRequiredError();
}
