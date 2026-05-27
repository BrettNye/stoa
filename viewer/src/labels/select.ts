export interface LabelCandidate {
  id: string;
  degree: number;
  distance: number; // camera→node distance (scene units), supplied by the shell
  isRegion: boolean; // node.type === "__wiki__"
}

export interface LabelParams {
  hubCount: number; // always-on top-degree real nodes
  budget: number; // max real-node labels on screen (hubs count toward it)
  maxDistance?: number; // optional proximity cap; default Infinity
  hoveredId?: string | null;
}

/**
 * Ordered list of node ids to label: regions first, then hubs, then nearest.
 * `hubCount` and `budget` are assumed >= 0 (a negative `hubCount` is clamped to 0).
 */
export function selectLabeledIds(
  candidates: LabelCandidate[],
  params: LabelParams,
): string[] {
  const { hubCount, budget, maxDistance = Infinity, hoveredId = null } = params;
  const chosen = new Set<string>();
  const out: string[] = [];
  const add = (id: string) => {
    if (!chosen.has(id)) { chosen.add(id); out.push(id); }
  };

  const real = candidates.filter((c) => !c.isRegion);
  // 1. region nodes always (unbudgeted)
  for (const c of candidates) if (c.isRegion) add(c.id);

  // 2. top hubs by degree (count toward budget)
  const byDegree = [...real].sort(
    (a, b) => b.degree - a.degree || a.id.localeCompare(b.id),
  );
  let realCount = 0;
  for (const c of byDegree.slice(0, Math.max(0, hubCount))) {
    if (realCount >= budget) break;
    add(c.id); realCount++;
  }

  // 3. proximity fill to budget by nearest distance within maxDistance
  const rest = real
    .filter((c) => !chosen.has(c.id) && c.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance || b.degree - a.degree || a.id.localeCompare(b.id));
  for (const c of rest) {
    if (realCount >= budget) break;
    add(c.id); realCount++;
  }

  // 4. hover always wins (even beyond budget), if it's a real candidate
  if (hoveredId && candidates.some((c) => c.id === hoveredId)) add(hoveredId);

  return out;
}
