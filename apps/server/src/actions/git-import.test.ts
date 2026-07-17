import { describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/database', () => ({ prisma: {} }));

import { normalizeGitContentPath } from './git-import';

describe('normalizeGitContentPath', () => {
  it('normalizes a repository-relative path', () => {
    expect(normalizeGitContentPath(' docs\\guides/ ')).toBe('docs/guides');
    expect(normalizeGitContentPath()).toBe('');
  });

  it.each(['../../etc', 'docs/../private', '/etc', 'C:\\Windows'])('rejects an escaping path: %s', (value) => {
    expect(() => normalizeGitContentPath(value)).toThrow('Git content path must stay inside the repository.');
  });
});
