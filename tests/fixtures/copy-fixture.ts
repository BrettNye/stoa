import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

export function copyFixtureVault(): string {
  const dest = mkdtempSync(join(tmpdir(), "vault-fixture-"));
  cpSync(join(__dirname, "test-vault"), dest, { recursive: true });
  return dest;
}
