import { existsSync, readFileSync, accessSync, constants } from "node:fs";
import { join } from "node:path";
import { PRIMER_MARKER_START } from "./ai-primer-template.js";

export type DiagnoseCheck = {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
};

export function runDiagnostics(opts: { home: string; vaultPath?: string }): DiagnoseCheck[] {
  const checks: DiagnoseCheck[] = [];
  checks.push(checkPrimer(opts.home));
  checks.push(checkMcpEntry(opts.home));
  if (opts.vaultPath) checks.push(checkVaultPath(opts.vaultPath));
  return checks;
}

function checkPrimer(home: string): DiagnoseCheck {
  const p = join(home, ".claude", "CLAUDE.md");
  if (!existsSync(p)) {
    return {
      name: "AI-primer present",
      ok: false,
      detail: `${p} does not exist`,
      fix: "Run `stoa onboard` to install the AI-primer.",
    };
  }
  const content = readFileSync(p, "utf8");
  const ok = content.includes(PRIMER_MARKER_START);
  return {
    name: "AI-primer present",
    ok,
    detail: ok ? `Found primer markers in ${p}` : `${p} exists but has no Stoa primer block`,
    fix: ok ? undefined : "Run `stoa onboard --regenerate-primer`.",
  };
}

function checkMcpEntry(home: string): DiagnoseCheck {
  const p = join(home, ".claude", "settings.json");
  if (!existsSync(p)) {
    return {
      name: "Claude Code MCP entry",
      ok: false,
      detail: `${p} not found`,
      fix: "Run `stoa onboard`.",
    };
  }
  try {
    const cfg = JSON.parse(readFileSync(p, "utf8"));
    const ok = !!cfg?.mcpServers?.stoa;
    return {
      name: "Claude Code MCP entry",
      ok,
      detail: ok ? "settings.json contains mcpServers.stoa" : "settings.json present but no stoa entry",
      fix: ok ? undefined : "Run `stoa onboard`.",
    };
  } catch (e) {
    return {
      name: "Claude Code MCP entry",
      ok: false,
      detail: `Could not parse ${p}: ${(e as Error).message}`,
      fix: "Fix the malformed settings.json and re-run.",
    };
  }
}

function checkVaultPath(vaultPath: string): DiagnoseCheck {
  if (!existsSync(vaultPath)) {
    return {
      name: "Vault path",
      ok: false,
      detail: `${vaultPath} does not exist`,
      fix: "Recreate the vault or run `stoa onboard`.",
    };
  }
  try {
    accessSync(vaultPath, constants.W_OK);
    return {
      name: "Vault path",
      ok: true,
      detail: `${vaultPath} exists and is writable`,
    };
  } catch {
    return {
      name: "Vault path",
      ok: false,
      detail: `${vaultPath} is not writable`,
      fix: "Check folder permissions.",
    };
  }
}
