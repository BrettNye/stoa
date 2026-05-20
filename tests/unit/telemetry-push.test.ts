import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

describe('vault_telemetry-push', () => {
  beforeEach(() => {
    process.env.STADIUM_API_KEY = 'sk';
    process.env.STADIUM_BASE_URL = 'https://api.test';
  });

  afterEach(() => {
    delete process.env.STADIUM_API_KEY;
    delete process.env.STADIUM_BASE_URL;
  });

  it('POSTs to /telemetry/move-usage with the event body', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ ok: true, new_xp: 42, level: 4 }),
        { status: 200 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { telemetryPushTool } = await import('../../src/tools/telemetry-push.js');
    const out = await telemetryPushTool.handler({
      real_skill_id: 'rs_tdd',
      source: 'journal',
      reference_link: 'wikis/alpha/journal/journal-2026-05-03-foo.md'
    });

    expect(out.ok).toBe(true);
    expect(out.new_xp).toBe(42);
    expect(out.level).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/telemetry/move-usage');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      real_skill_id: 'rs_tdd',
      source: 'journal',
      reference_link: 'wikis/alpha/journal/journal-2026-05-03-foo.md'
    });
  });

  it('attaches Bearer token from resolved config', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ ok: true, new_xp: 1, level: 1 }),
        { status: 200 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { telemetryPushTool } = await import('../../src/tools/telemetry-push.js');
    await telemetryPushTool.handler({
      real_skill_id: 'rs_x',
      source: 'task',
      reference_link: 'tasks/task-foo'
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk');
  });

  it('surfaces server error_code (unknown_real_skill_id) via StadiumApiError', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ error_code: 'unknown_real_skill_id', message: 'no such real-skill' }),
        { status: 404 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { telemetryPushTool } = await import('../../src/tools/telemetry-push.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    let caught: unknown;
    try {
      await telemetryPushTool.handler({
        real_skill_id: 'rs_missing',
        source: 'journal',
        reference_link: 'wikis/alpha/journal/journal-x.md'
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    expect((caught as InstanceType<typeof StadiumApiError>).error_code).toBe('unknown_real_skill_id');
  });

  it('surfaces rate_limited error_code via StadiumApiError', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(
        JSON.stringify({ error_code: 'rate_limited', message: 'Too many requests' }),
        { status: 429 }
      ))
    );
    vi.stubGlobal('fetch', fetchMock);
    const { telemetryPushTool } = await import('../../src/tools/telemetry-push.js');
    const { StadiumApiError } = await import('../../src/core/stadium-client.js');
    let caught: unknown;
    try {
      await telemetryPushTool.handler({
        real_skill_id: 'rs_tdd',
        source: 'journal',
        reference_link: 'wikis/alpha/journal/journal-y.md'
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(StadiumApiError);
    expect((caught as InstanceType<typeof StadiumApiError>).error_code).toBe('rate_limited');
  });

  it('exposes the canonical tool name and description', async () => {
    const { telemetryPushTool } = await import('../../src/tools/telemetry-push.js');
    expect(telemetryPushTool.name).toBe('vault_telemetry-push');
    expect(typeof telemetryPushTool.description).toBe('string');
    expect(telemetryPushTool.description.length).toBeGreaterThan(0);
  });
});
