import { writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { recall } from "./recall.js";
import { serializeFrontmatter, parseFrontmatter } from "./frontmatter.js";
import { slugify } from "./ids.js";

export interface SynthesizeInput {
  topic: string;
  wiki?: string;
  inputs?: string[];
  by_agent?: string;
  scope?: "topic" | "memory";
}

export interface SynthesizeResult {
  id: string;
  path: string;
  inputs_used: string[];
  last_compiled: string;
  was_overwrite: boolean;
}

export function synthesize(vaultPath: string, input: SynthesizeInput): SynthesizeResult {
  const scope = input.scope ?? "topic";

  if (scope === "memory" && !input.by_agent) {
    throw new Error("by_agent is required when scope=memory");
  }

  // Resolve id, wiki, path based on scope
  let id: string;
  let wiki: string;
  let path: string;
  if (scope === "memory") {
    const agent = input.by_agent!;
    id = `synthesis-${agent}-memory`;
    wiki = "_agents";
    path = join(vaultPath, "wikis", "_agents", "synthesis", `${id}.md`);
  } else {
    const slug = slugify(input.topic);
    id = `synthesis-${slug}`;
    wiki = input.wiki ?? "alpha";
    path = join(vaultPath, "wikis", wiki, "synthesis", `${id}.md`);
  }

  const today = new Date().toISOString().slice(0, 10);

  // Discover inputs
  let inputIds: string[] = input.inputs ?? [];
  if (inputIds.length === 0) {
    if (scope === "memory") {
      inputIds = collectAgentPages(vaultPath, input.by_agent!);
    } else {
      const r = recall(vaultPath, { topic: input.topic, wiki, layer: "all", limit: 25 });
      let candidateIds = r.hits.filter(h => h.id !== id).map(h => h.id);
      if (input.by_agent) {
        candidateIds = candidateIds.filter(cid => isAuthoredBy(vaultPath, cid, input.by_agent!));
      }
      inputIds = candidateIds;
    }
  }

  const fm: Record<string, any> = {
    id,
    title: scope === "memory"
      ? `${input.by_agent} memory — synthesis`
      : `${input.topic} — synthesis`,
    type: "synthesis",
    wiki,
    status: "draft",
    created: today,
    updated: today,
    summary: scope === "memory"
      ? `Per-agent memory synthesis for ${input.by_agent} compiled from ${inputIds.length} pages.`
      : `Synthesis of ${inputIds.length} pages on "${input.topic}".`,
    tags: scope === "memory" ? ["memory", input.by_agent] : [],
    last_compiled: today,
    sources: inputIds.map(i => `[[wikis/${wiki}/${typeFolderForId(i)}/${i}]]`)
  };
  if (input.by_agent) fm.by_agent = input.by_agent;
  if (scope === "memory") fm.scope = "memory";

  const heading = scope === "memory" ? `${input.by_agent} memory` : input.topic;
  const body = `# ${heading}\n\n_Compiled ${today} from ${inputIds.length} input page(s)._\n\n## Inputs cited\n\n${inputIds.map(i => `- [[${i}]]`).join("\n")}\n\n## Notes\n\n(Hand-edit this section to add the actual synthesis prose. The agent should produce this from input contents on real runs; this stub is what \`vault.synthesize\` writes when called without an LLM.)\n`;

  const wasOverwrite = existsSync(path);
  writeFileSync(path, serializeFrontmatter(fm, body));

  return { id, path, inputs_used: inputIds, last_compiled: today, was_overwrite: wasOverwrite };
}

function typeFolderForId(id: string): string {
  if (id.startsWith("concept-")) return "concepts";
  if (id.startsWith("guide-")) return "guides";
  if (id.startsWith("decision-")) return "decisions";
  if (id.startsWith("synthesis-")) return "synthesis";
  if (id.startsWith("idea-")) return "ideas";
  if (id.startsWith("question-")) return "questions";
  if (id.startsWith("spec-")) return "specs";
  if (id.startsWith("source-")) return "sources";
  if (id.startsWith("journal-")) return "journal";
  if (id.startsWith("task-")) return "tasks";
  return "concepts";
}

function isAuthoredBy(vaultPath: string, pageId: string, agent: string): boolean {
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return false;
  const folder = typeFolderForId(pageId);
  const target = `agent:${agent}`;
  for (const wikiName of readdirSync(wikisDir)) {
    const candidate = join(wikisDir, wikiName, folder, `${pageId}.md`);
    if (!existsSync(candidate)) continue;
    try {
      const { frontmatter } = parseFrontmatter(readFileSync(candidate, "utf8"));
      if (frontmatter.author === target) return true;
      if (folder === "tasks" && frontmatter.claimed_by === target) return true;
      return false;
    } catch {
      return false;
    }
  }
  return false;
}

function collectAgentPages(vaultPath: string, agent: string): string[] {
  const target = `agent:${agent}`;
  const out: string[] = [];
  const wikisDir = join(vaultPath, "wikis");
  if (!existsSync(wikisDir)) return out;
  for (const wikiName of readdirSync(wikisDir)) {
    for (const folder of ["journal", "tasks"]) {
      const dir = join(wikisDir, wikiName, folder);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith(".md")) continue;
        const filePath = join(dir, file);
        try {
          const { frontmatter } = parseFrontmatter(readFileSync(filePath, "utf8"));
          if (frontmatter.author === target ||
              (folder === "tasks" && frontmatter.claimed_by === target)) {
            const id = String(frontmatter.id ?? file.replace(/\.md$/, ""));
            out.push(id);
          }
        } catch {
          // skip malformed
        }
      }
    }
  }
  return out;
}
