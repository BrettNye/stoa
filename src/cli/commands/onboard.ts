import { Command } from "commander";
import { homedir } from "node:os";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { detectClients } from "../../core/client-detection.js";
import { upsertMcpServer } from "../../core/mcp-config-merge.js";
import { renderPrimer, writePrimerToUserScope } from "../../core/ai-primer-template.js";
import { detectSyncFolders } from "../../core/sync-folder-detection.js";
import { writeOnboardingState } from "../../core/onboarding-state.js";
import { seedVault } from "../../core/vault-seeding.js";
import { runInterview } from "../../core/onboard-interview.js";
import { runDiagnostics } from "../../core/onboard-diagnose.js";
import { buildWikiClaudemdPrompt, fallbackWikiClaudemd } from "../../core/onboard-wiki-claudemd-gen.js";

const SURFACE_TO_WIKI: Record<string, string> = {
  meetings: "meetings",
  code: "codebase",
  research: "research",
  planning: "planning",
  content: "content",
};

export function registerOnboard(program: Command): void {
  program
    .command("onboard")
    .description(
      "Interactive onboarding: detect AI clients, write config, seed vault, install AI-primer."
    )
    .option("--diagnose", "Run diagnostic checks against the current install instead of onboarding.")
    .action(async (opts: { diagnose?: boolean }) => {
      const home = homedir();

      if (opts.diagnose) {
        const checks = runDiagnostics({ home });
        for (const c of checks) {
          process.stdout.write(
            `${c.ok ? "✓" : "✗"} ${c.name}\n    ${c.detail}\n${c.fix ? "    Fix: " + c.fix + "\n" : ""}`
          );
        }
        return;
      }

      const clients = detectClients(home, process.platform).filter(
        (c) => c.client === "claude-code"
      );
      if (clients.length === 0) {
        process.stdout.write(
          "No Claude Code install detected at ~/.claude/. Install Claude Code first, then re-run.\n"
        );
        process.exitCode = 1;
        return;
      }

      const syncFolders = detectSyncFolders(home, process.platform);
      const answers = await runInterview({ syncFolders });

      const vault_path = answers.vault_path_chosen ?? join(home, "Stoa");

      // Map raw surface keys to wiki names, deduplicate, limit to 3.
      const wikiNames =
        answers.team_or_solo === "solo"
          ? Array.from(
              new Set(
                answers.work_surfaces
                  .map((s) => SURFACE_TO_WIKI[s])
                  .filter(Boolean)
              )
            ).slice(0, 3)
          : [];

      const cc = clients[0];

      // Step 1: write MCP entry into Claude Code settings.json
      upsertMcpServer(cc.settings_path, "stoa", {
        command: "stoa",
        args: ["--mcp"],
        env: { STOA_VAULT_PATH: vault_path },
      });

      // Step 2: write AI-primer into ~/.claude/CLAUDE.md
      writePrimerToUserScope(
        cc.user_md_path,
        renderPrimer({
          role: answers.role,
          interaction_mode: answers.interaction_mode,
          team_mode: answers.team_or_solo === "team",
          vault_path,
          wiki_names: wikiNames,
        })
      );

      // Step 3: solo only — seed vault + write per-wiki CLAUDE.md
      if (answers.team_or_solo === "solo") {
        seedVault({
          vault_path,
          wiki_names: wikiNames,
          inbox_items: answers.wish_remembered ? [answers.wish_remembered] : [],
        });

        for (const wiki of wikiNames) {
          const desc = answers.per_wiki_descriptions[wiki] ?? "";
          const wikiClaudeMdPath = join(vault_path, "wikis", wiki, "CLAUDE.md");
          process.stdout.write(
            `\nAsk your AI to generate ${wiki}'s CLAUDE.md:\n\n${buildWikiClaudemdPrompt({ wiki_name: wiki, workflow_freetext: desc })}\n\n`
          );
          writeFileSync(
            wikiClaudeMdPath,
            fallbackWikiClaudemd({ wiki_name: wiki, workflow_freetext: desc })
          );
        }
      }

      // Step 4: persist onboarding state
      writeOnboardingState(vault_path, {
        role: answers.role,
        interaction_mode: answers.interaction_mode,
        work_surfaces: answers.work_surfaces,
        team_or_solo: answers.team_or_solo,
        client: "claude-code",
        vault_path,
        interview_completed_at: new Date().toISOString(),
      });

      process.stdout.write(
        "\nDone. Restart Claude Code, then ask: 'Are your Stoa vault tools available?'\n"
      );
    });
}
