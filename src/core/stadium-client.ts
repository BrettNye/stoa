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
