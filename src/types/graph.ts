import { z } from "zod";

export const RawPage = z.object({
  id: z.string(),
  type: z.string(),
  wiki: z.string(),
  title: z.string().default(""),
  summary: z.string().default(""),
  tags: z.array(z.string()).default([]),
  status: z.string().default("draft"),
  updated: z.string().default(""),
  path: z.string(),
});
export type RawPage = z.infer<typeof RawPage>;

export const PagesIndex = z.object({ pages: z.array(RawPage) });
export type PagesIndex = z.infer<typeof PagesIndex>;

export const LinksEntry = z.object({
  outbound: z.array(z.string()).default([]),
  inbound: z.array(z.string()).default([]),
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
