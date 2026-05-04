import { randomUUID } from 'node:crypto';

export class StadiumApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly error_code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'StadiumApiError';
  }
}

export interface StadiumClientOptions {
  api_key: string;
  base_url: string;
  retryDelayMs?: number;
}

export class StadiumClient {
  private readonly retryDelayMs: number;

  constructor(private readonly opts: StadiumClientOptions) {
    this.retryDelayMs = opts.retryDelayMs ?? 250;
  }

  async getHealth(): Promise<{ status: string }> {
    return this.request('GET', '/health', undefined);
  }

  // Profile / real-skill / move registration
  async registerProfile(body: {
    species_name: string;
    evolution_stage: 'basic' | 'stage1' | 'stage2';
    vault_profile_id: string;
  }): Promise<{
    profile_id: string;
    stats: { hp: number; atk: number; def: number; spd: number; types: string[] };
  }> {
    return this.post('/profiles/register', body);
  }

  async registerRealSkill(body: {
    skill_id: string;
    skill_md_content: string;
  }): Promise<{
    real_skill_id: string;
    modifier_function: { accuracy_mod: number; power_mod: number; effect_chance_mod: number; level_scaling: number };
  }> {
    return this.post('/real-skills/register', body);
  }

  async refreshRealSkill(real_skill_id: string, body: { skill_md_content: string }): Promise<{
    real_skill_id: string;
    modifier_function: { accuracy_mod: number; power_mod: number; effect_chance_mod: number; level_scaling: number };
  }> {
    return this.post(`/real-skills/${encodeURIComponent(real_skill_id)}/refresh`, body);
  }

  async fuseMove(body: { canonical_move_name: string; real_skill_id: string }): Promise<{ move_id: string }> {
    return this.post('/moves/fuse', body);
  }

  // Telemetry
  async pushTelemetry(body: { real_skill_id: string; source: string; reference_link: string }): Promise<{ ok: true; new_xp: number; level: number }> {
    return this.post('/telemetry/move-usage', body);
  }

  // Matchmaking
  async queueMatch(body: { opponent_trainer_id: string; ruleset?: 'standard' }): Promise<{ match_id: string; status: string }> {
    return this.post('/matches', { ruleset: 'standard', ...body });
  }

  async listInvites(): Promise<{ invites: Array<{ match_id: string; from_trainer_id: string; created_at: string }> }> {
    return this.get('/trainers/me/invites');
  }

  async acceptMatch(match_id: string): Promise<{ match_id: string; status: 'drafting' }> {
    return this.post(`/matches/${encodeURIComponent(match_id)}/accept`, {});
  }

  async getMatchState(match_id: string, since_turn?: number): Promise<{
    match_id: string;
    status: string;
    turn: number;
    events: Array<Record<string, unknown>>;
    state: Record<string, unknown> | null;
  }> {
    return this.get(`/matches/${encodeURIComponent(match_id)}`, since_turn !== undefined ? { since: since_turn } : undefined);
  }

  async submitDraft(match_id: string, body: { picks: string[] }): Promise<{ match_id: string; status: string }> {
    return this.post(`/matches/${encodeURIComponent(match_id)}/draft`, body);
  }

  async submitMove(match_id: string, body: { turn: number; move_id: string; target?: string }): Promise<{ match_id: string; turn: number; status: string }> {
    return this.post(`/matches/${encodeURIComponent(match_id)}/move`, body);
  }

  // Spectator (unauthenticated; same client still attaches the bearer — server ignores it)
  async getSpectatorState(match_id: string): Promise<{
    match_id: string; status: string; turn: number; events: Array<Record<string, unknown>>; state: Record<string, unknown> | null;
  }> {
    return this.get(`/matches/${encodeURIComponent(match_id)}/state`);
  }

  async get<T = unknown>(path: string, query?: Record<string, string | number>): Promise<T> {
    const qs = query
      ? '?' + new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()
      : '';
    return this.request<T>('GET', `${path}${qs}`, undefined);
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body: unknown): Promise<T> {
    const url = `${this.opts.base_url}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.api_key}`,
      'Content-Type': 'application/json'
    };
    if (method === 'POST') headers['Idempotency-Key'] = randomUUID();
    const init: RequestInit = {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    };

    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await fetch(url, init);
        if (resp.ok) {
          if (resp.status === 204) return undefined as T;
          return (await resp.json()) as T;
        }
        if (resp.status >= 500) {
          lastErr = await toApiError(resp);
          if (attempt < 3) {
            await sleep(this.retryDelayMs * Math.pow(2, attempt - 1));
            continue;
          }
          throw lastErr;
        }
        // 4xx (including 429) — fast fail, no retry
        throw await toApiError(resp);
      } catch (e: unknown) {
        if (e instanceof StadiumApiError) throw e;
        // Network error — retry
        lastErr = e;
        if (attempt < 3) {
          await sleep(this.retryDelayMs * Math.pow(2, attempt - 1));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }
}

async function toApiError(resp: Response): Promise<StadiumApiError> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any = {};
  try {
    parsed = await resp.json();
  } catch {
    /* non-JSON body */
  }
  return new StadiumApiError(
    resp.status,
    parsed.error_code ?? `http_${resp.status}`,
    parsed.message ?? resp.statusText ?? 'unknown error',
    parsed.details
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
