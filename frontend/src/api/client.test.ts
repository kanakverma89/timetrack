import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './client';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const mock = vi.fn(impl);
  vi.stubGlobal('fetch', mock);
  return mock;
}

describe('apiFetch', () => {
  it('sends credentials and the CSRF header, and parses JSON', async () => {
    const mock = stubFetch(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(apiFetch('/meta')).resolves.toEqual({ ok: true });
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/meta');
    expect(init?.credentials).toBe('include');
    expect((init?.headers as Record<string, string>)['X-Requested-With']).toBe('timetrack');
  });

  it('serialises JSON bodies with a content type', async () => {
    const mock = stubFetch(async () => new Response('{}', { status: 200 }));
    await apiFetch('/x', { method: 'POST', body: { a: 1 } });
    const init = mock.mock.calls[0]?.[1];
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":1}');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('maps the backend error envelope onto ApiError', async () => {
    stubFetch(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'bad',
              field_errors: { week_start_date: 'nope' },
              request_id: 'abc',
            },
          }),
          { status: 422 },
        ),
    );
    const error = await apiFetch('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: 'bad',
      requestId: 'abc',
      fieldErrors: { week_start_date: 'nope' },
    });
  });

  it('turns a non-JSON error page into a generic ApiError', async () => {
    stubFetch(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 502, code: 'HTTP_ERROR' });
  });

  it('turns a network failure into a NETWORK_ERROR', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
  });

  it('returns undefined for 204 responses', async () => {
    stubFetch(async () => new Response(null, { status: 204 }));
    await expect(apiFetch('/x', { method: 'POST' })).resolves.toBeUndefined();
  });
});
