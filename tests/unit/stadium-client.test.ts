import { describe, it, expect, beforeEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('StadiumClient transport', () => {
  it('attaches Bearer token to every request', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk_test', base_url: 'https://api.test' });
    await client.getHealth();
    expect(fetchMock).toHaveBeenCalledWith('https://api.test/health',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer sk_test' }) }));
  });

  it('retries 5xx up to 3 times then throws StadiumApiError', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('boom', { status: 503 })));
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient, StadiumApiError } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk', base_url: 'https://api.test', retryDelayMs: 1 });
    await expect(client.getHealth()).rejects.toThrow(StadiumApiError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not retry 4xx — fast-fails immediately', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error_code: 'not_found', message: 'Not found' }), { status: 404 }))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient, StadiumApiError } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk', base_url: 'https://api.test', retryDelayMs: 1 });
    await expect(client.getHealth()).rejects.toThrow(StadiumApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry 429 — fast-fails immediately', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ error_code: 'rate_limited', message: 'Too many requests' }), { status: 429 }))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient, StadiumApiError } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk', base_url: 'https://api.test', retryDelayMs: 1 });
    await expect(client.getHealth()).rejects.toThrow(StadiumApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('parses error_code, message, details from JSON error body', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ error_code: 'invalid_trainer', message: 'Trainer not found', details: { id: 'trn_abc' } }),
        { status: 422 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient, StadiumApiError } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk', base_url: 'https://api.test', retryDelayMs: 1 });
    let caught: unknown;
    try {
      await client.getHealth();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    const err = caught as InstanceType<typeof StadiumApiError>;
    expect(err.status).toBe(422);
    expect(err.error_code).toBe('invalid_trainer');
    expect(err.message).toBe('Trainer not found');
    expect(err.details).toEqual({ id: 'trn_abc' });
  });

  it('POST requests include Idempotency-Key header; GET requests do not', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk', base_url: 'https://api.test' });

    // GET — no Idempotency-Key
    await client.get('/some-resource');
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.test/some-resource',
      expect.objectContaining({ headers: expect.not.objectContaining({ 'Idempotency-Key': expect.anything() }) })
    );

    // POST — has Idempotency-Key
    await client.post('/some-resource', { foo: 'bar' });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.test/some-resource',
      expect.objectContaining({ headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) }) })
    );
  });

  it('returns undefined for 204 No Content responses', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk', base_url: 'https://api.test' });
    const result = await client.get('/no-content');
    expect(result).toBeUndefined();
  });

  it('retries network errors up to 3 times', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error('network failure')));
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk', base_url: 'https://api.test', retryDelayMs: 1 });
    await expect(client.getHealth()).rejects.toThrow('network failure');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('succeeds on second attempt after first 5xx', async () => {
    let calls = 0;
    const fetchMock = vi.fn(() => {
      calls++;
      if (calls === 1) return Promise.resolve(new Response('error', { status: 503 }));
      return Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk', base_url: 'https://api.test', retryDelayMs: 1 });
    const result = await client.getHealth();
    expect(result).toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('get<T> forwards query params as URL search params', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify([]), { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    const { StadiumClient } = await import('../../src/core/stadium-client.js');
    const client = new StadiumClient({ api_key: 'sk', base_url: 'https://api.test' });
    await client.get('/search', { q: 'pikachu', limit: 10 });
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('/search?');
    expect(calledUrl).toContain('q=pikachu');
    expect(calledUrl).toContain('limit=10');
  });
});
