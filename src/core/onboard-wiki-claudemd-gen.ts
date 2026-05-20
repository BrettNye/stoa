const EXAMPLE_CLAUDEMD = `# meal-planning — wiki conventions\n\n**Mode:** idea-map\n**Scope:** Weekly dinner planning, kept recipes\n\n## Tag vocabulary\n- recipe\n- weeknight\n\n## How types map here\n- \`concept\` = a recipe   (concept-pasta-aglio.md)\n- \`idea\`    = a dish to try\n`;

export function buildWikiClaudemdPrompt(args: { wiki_name: string; workflow_freetext: string }): string {
  return [
    `Generate a CLAUDE.md for a Stoa vault wiki named "${args.wiki_name}".`,
    `Use case described by the user: "${args.workflow_freetext}"`,
    ``,
    `Required sections, in order:`,
    `1. Title heading: "# ${args.wiki_name} — wiki conventions"`,
    `2. **Mode:** one of (idea-map | project-doc | learning | mixed)`,
    `3. **Scope:** one sentence`,
    `4. ## Tag vocabulary — 5-8 bullets of tags relevant to the domain`,
    `5. ## How types map here — bullets mapping each canonical type to a domain example`,
    `6. ## Things to file — bullets`,
    `7. ## Things NOT to file here — bullets`,
    ``,
    `Output the file content only. No prose around it. No code fence.`,
    ``,
    `Example for a different wiki (meal-planning):`,
    EXAMPLE_CLAUDEMD,
  ].join("\n");
}

export function fallbackWikiClaudemd(args: { wiki_name: string; workflow_freetext: string }): string {
  return [
    `# ${args.wiki_name} — wiki conventions`,
    ``,
    `**Mode:** mixed`,
    `**Scope:** ${args.workflow_freetext}`,
    ``,
    `## Tag vocabulary`,
    `_(fill in as patterns emerge — refine later with \`stoa onboard --regenerate-wiki ${args.wiki_name}\`)_`,
    ``,
    `## How types map here`,
    `_(AI declined to generate. Refine later.)_`,
    ``,
  ].join("\n");
}
