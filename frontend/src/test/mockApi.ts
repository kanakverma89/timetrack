import { vi } from 'vitest';

interface Result {
  status?: number;
  body?: unknown;
}
type Handler = (url: URL, init: RequestInit) => Result | Promise<Result>;

/** Replace global fetch with a router keyed by "METHOD /path" (path relative to /api/v1). */
export function mockApi(routes: Record<string, Handler>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://localhost');
    const method = (init.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname.replace(/^\/api\/v1/, '')}`;
    calls.push(key);
    const handler = routes[key];
    if (!handler) throw new Error(`Unmocked request: ${key}`);
    const { status = 200, body } = await handler(url, init);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

export function errorBody(code: string, message: string, status: number) {
  return {
    status,
    body: { error: { code, message, field_errors: {}, request_id: 'req-test-0001' } },
  };
}
