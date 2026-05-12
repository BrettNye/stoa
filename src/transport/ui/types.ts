export interface ApiHealth {
  ok: true;
  vault: string;
  wikis: number;
  indexedAt: string | null;
}

export interface ApiTask {
  id: string;
  title: string;
  wiki: string;
  status: "pending" | "claimed" | "in_progress" | "completed" | "failed" | "blocked";
  claimed_by?: string;
  claimed_at?: string;
  channel?: string;
  required_pokemon_type?: string;
  updated: string;
}

export interface ApiChannelEntry {
  id: string;
  channel: string;
  wiki: string;
  author: string;
  ts: string;
  excerpt: string;
  pageId: string;
}

export interface ApiChannelSummary {
  name: string;
  wiki: string;
  lastEntry: ApiChannelEntry | null;
  count24h: number;
}

export interface ApiAgent {
  id: string;
  wiki: string;
  pokemon: string;
  pokemon_type?: string;
  evolution_stage: "basic" | "stage1" | "stage2";
  spriteUrl: string;
  updated: string;
  claimedTaskCount: number;
}

export interface ApiWiki {
  name: string;
  mode: string;
  pageCount: number;
  activeTasks: number;
}

export interface ApiSuggestion {
  name: string;
  pokemon_type: string;
  spriteUrl: string;
}

export interface ClaimRequest {
  agent_id: string;
  expected_updated: string;
  wiki?: string;
}

export interface ClaimResponse {
  ok: true;
  task: ApiTask;
}

export interface ClaimConflictResponse {
  ok: false;
  error: "AlreadyClaimedError" | "OccMismatch";
  actual_claimer?: string;
  current_updated?: string;
}

export interface PostRequest {
  content: string;
  wiki?: string;
  session_id?: string;
}

export interface PostResponse {
  ok: true;
  entry: ApiChannelEntry;
}

export interface RegisterAgentRequest {
  selected_species: string;
  dev_specialty?: string;
  pokemon_type?: string;
  evolution_stage?: "basic" | "stage1" | "stage2";
}

export interface RegisterAgentResponse {
  ok: true;
  agent: ApiAgent;
}

// ---- Stuck-claim watchdog ----
export interface ReleaseRequest {
  expected_updated: string;
  reason?: string;
}

export interface ReleaseResponse {
  ok: true;
  task: ApiTask;
}

export interface ReleaseConflictResponse {
  ok: false;
  error: "OccMismatch" | "NotClaimed";
  current_updated?: string;
  current_status?: ApiTask["status"];
}

// ---- Synthesis staleness rail ----
export interface ApiSynthesisStalenessInput {
  id: string;
  updated: string;
}

export interface ApiSynthesisStaleness {
  id: string;
  wiki: string;
  title: string;
  last_compiled: string | null;
  lag_days: number | null;
  stale_inputs: ApiSynthesisStalenessInput[];
}

export interface ApiSynthesisStalenessResponse {
  syntheses: ApiSynthesisStaleness[];
  generatedAt: string;
}
