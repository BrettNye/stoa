import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { recall } from "./recall.js";
import { serializeFrontmatter } from "./frontmatter.js";
import { slugify } from "./ids.js";

export interface SynthesizeInput {
  topic: string;
  wiki?: string;
  inputs?: string[];
}

export interface SynthesizeResult {
  id: string;
  path: string;
  inputs_used: string[];
  last_compiled: string;
  was_overwrite: boolean;
}

export function synthesize(vaultPath: string, input: SynthesizeInput): SynthesizeResult {
  const slug = slugify(input.topic);
  const id = `synthesis-${slug}`;
  const wiki = input.wiki ?? "alpha";
  const path = join(vaultPath, "wikis", wiki, "synthesis", `${id}.md`);
  const today = new Date().toISOString().slice(0, 10);

  // Discover inputs via recall (skip the synthesis itself if it exists)
  let inputIds: string[] = input.inputs ?? [];
  if (inputIds.length === 0) {
    const r = recall(vaultPath, { topic: input.topic, wiki, layer: "all", limit: 25 });
    inputIds = r.hits.filter(h => h.id !== id).map(h => h.id);
  }

  const fm: Record<string, any> = {
    id,
    title: `${input.topic} — synthesis`,
    type: "synthesis",
    wiki,
    status: "draft",
    created: today,
    updated: today,
    summary: `Synthesis of ${inputIds.length} pages on "${input.topic}".`,
    tags: [],
    last_compiled: today,
    sources: inputIds.map(i => `[[wikis/${wiki}/${typeFolderForId(i)}/${i}]]`)
  };

  const body = `# ${input.topic}\n\n_Compiled ${today} from ${inputIds.length} input page(s)._\n\n## Inputs cited\n\n${inputIds.map(i => `- [[${i}]]`).join("\n")}\n\n## Notes\n\n(Hand-edit this section to add the actual synthesis prose. The agent should produce this from input contents on real runs; this stub is what \`vault.synthesize\` writes when called without an LLM.)\n`;

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
