import { describe, expect, it } from 'vitest';
import { loggablePath } from './observability';

describe('loggablePath', () => {
  it('never logs a join-link token', () => {
    const token = `nlj_${'Ab3_-'.repeat(8)}xyz`;
    expect(loggablePath(`/api/public/join/${token}`)).toBe('/api/public/join/[token]');
    expect(loggablePath(`/api/app/join/${token}`)).toBe('/api/app/join/[token]');
  });

  it('leaves every other path alone', () => {
    expect(loggablePath('/api/app/projects/p1/join-links/l1/regenerate')).toBe('/api/app/projects/p1/join-links/l1/regenerate');
    expect(loggablePath('/api/public/sites/p1')).toBe('/api/public/sites/p1');
  });
});
