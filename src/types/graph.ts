import { z } from "zod";

// Real-world `_index/pages.json` entries are occasionally missing `id`, `type`,
// or `wiki` (but always carry `path`). Rather than reject the whole index, we
// repair each entry from its `path` before validation, following the vault's
// own conventions: the id equals the filename stem, and the wiki is the first
// segment after `wikis/`. This keeps a few imperfect pages from 500-ing the
// entire graph. `path` itself remains required — an entry without it cannot be
// a node and is dropped by `.array(...).catch`-style filtering at the call site.
const repairRawPage = (v: unknown): unknown => {
  if (!v || typeof v !== "object") return v;
  const o: Record<string, unknown> = { ...(v as Record<string, unknown>) };
  const path = typeof o.path === "string" ? o.path : undefined;
  if (typeof o.id !== "string") {
    o.id = path ? (path.split("/").pop() ?? "").replace(/\.md$/, "") || "unknown" : "unknown";
  }
  if (typeof o.wiki !== "string") {
    const m = path?.match(/(?:^|\/)wikis\/([^/]+)\//);
    o.wiki = m ? m[1] : "unknown";
  }
  if (typeof o.type !== "string") o.type = "unknown";
  return o;
};

export const RawPage = z.preprocess(
  repairRawPage,
  z.object({
    id: z.string(),
    type: z.string(),
    wiki: z.string(),
    title: z.string().default(""),
    summary: z.string().default(""),
    tags: z.array(z.string()).default([]),
    status: z.string().default("draft"),
    updated: z.string().default(""),
    path: z.string(),
  }),
);
export type RawPage = z.infer<typeof RawPage>;

export const PagesIndex = z.object({ pages: z.array(RawPage) });
export type PagesIndex = z.infer<typeof PagesIndex>;

// Real `_index/links.json` arrays occasionally contain `null` (or other
// non-string) entries; filter them rather than rejecting the whole index.
const linkIdArray = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : v),
  z.array(z.string()).default([]),
);
export const LinksEntry = z.object({
  outbound: linkIdArray,
  inbound: linkIdArray,
});
export const LinksIndex = z.record(z.string(), LinksEntry);
export type LinksIndex = z.infer<typeof LinksIndex>;

export interface GraphNode {
  id: string;
  wiki: string;
  type: string;
  title: string;
  summary: string;
  tags: string[];
  status: string;
  updated: string;
  path: string;
  degree: number;
}

export interface GraphLink {
  source: string;
  target: string;
}

export interface Graph {
  nodes: GraphNode[];
  links: GraphLink[];
}
