import { afterEach, describe, expect, it, vi } from 'vitest';
import { newIdempotencyKey } from './idempotency';

// The backend accepts 8-100 letters, digits, hyphens and underscores.
const VALID = /^[A-Za-z0-9_-]{8,100}$/;

afterEach(() => vi.unstubAllGlobals());

describe('newIdempotencyKey', () => {
  it('is valid for the API and different every time', () => {
    const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey));
    expect(keys.size).toBe(50);
    for (const key of keys) expect(key).toMatch(VALID);
  });

  it('still works where crypto.randomUUID is unavailable (non-secure contexts)', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => bytes.map((_, i) => (i * 37 + 11) % 256),
    });
    const key = newIdempotencyKey();
    expect(key).toMatch(VALID);
    expect(key).toHaveLength(32);
  });
});
