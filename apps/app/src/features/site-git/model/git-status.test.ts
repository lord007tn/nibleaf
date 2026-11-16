import { describe, expect, it } from 'vitest';
import { gitStatusTone } from './git-status';

describe('gitStatusTone', () => {
  it.each([
    ['FAILED', 'destructive'],
    ['CONFLICT', 'destructive'],
    ['SUCCEEDED', 'default'],
    ['READY', 'default'],
    ['QUEUED', 'secondary'],
    ['RUNNING', 'secondary'],
    // Anything else, as main did: unknown, lower case, empty.
    ['PAUSED', 'secondary'],
    ['failed', 'secondary'],
    ['', 'secondary'],
  ] as const)('%s → %s', (status, tone) => {
    expect(gitStatusTone(status)).toBe(tone);
  });
});
