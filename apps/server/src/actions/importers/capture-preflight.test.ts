import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('capture Redis preflight before any worker or lock', () => {
  const source = readFileSync(new URL('../../../../../tests/integration/import-fidelity/browser.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK');
  const end = source.indexOf('/** Every host');
  const env = {
    NIBLEAF_DEVSTACK_LOCK: 'unused-test-lock',
    POSTGRES_URL: 'postgresql://localhost/import_fidelity_test',
    NIBLEAF_CAPTURE_DATABASE: 'import_fidelity_test',
    API_PORT: '4410',
    REDIS_DB: '143',
    NIBLEAF_CAPTURE_REDIS_DB: '143',
  };
  const preflight = (overrides: Record<string, string | undefined>) => {
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    runInNewContext(source.slice(start, end), { assert, URL, process: { env: { ...env, ...overrides } } });
  };
  it.each([undefined, '', '0', '-1', '1.5', 'NaN', '9007199254740992'])('refuses an unset or invalid Redis DB: %s', (value) => {
    expect(() => preflight({ REDIS_DB: value })).toThrow(/Redis|REDIS/);
  });
  it('refuses a Redis DB different from the explicitly allocated capture DB', () => {
    expect(() => preflight({ REDIS_DB: '144' })).toThrow(/allocated/);
    expect(() => preflight({ NIBLEAF_CAPTURE_REDIS_DB: undefined })).toThrow(/allocated/);
  });
  it('accepts the explicitly allocated capture Redis DB', () => {
    expect(() => preflight({})).not.toThrow();
  });
});
