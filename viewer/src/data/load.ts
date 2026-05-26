import { buildGraph } from "@stoa/core/graph";
import { PagesIndex, LinksIndex, type Graph } from "@stoa/types/graph";

export class IndexUnavailableError extends Error {}

async function getJson(url: string): Promise<unknown> {
  const r = await fetch(url);
  if (!r.ok) throw new IndexUnavailableError(url);
  return r.json();
}

export async function loadStatic(base = "."): Promise<Graph> {
  const [p, l] = await Promise.all([
    getJson(`${base}/_index/pages.json`),
    getJson(`${base}/_index/links.json`),
  ]);
  return buildGraph(PagesIndex.parse(p).pages, LinksIndex.parse(l));
}

export async function loadServed(base = ""): Promise<Graph> {
  return (await getJson(`${base}/graph/data`)) as Graph;
}
