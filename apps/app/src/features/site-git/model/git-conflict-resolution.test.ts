import { gitConflictResolutionBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { conflictResolutionBody, isGitConflictResolutionFor } from './git-conflict-resolution';

describe('conflictResolutionBody', () => {
  it.each([
    ['OURS', 'ignored', { resolution: 'OURS' }],
    ['THEIRS', 'ignored', { resolution: 'THEIRS' }],
    ['CUSTOM', 'merged text', { resolution: 'CUSTOM', content: 'merged text' }],
    ['CUSTOM', '', { resolution: 'CUSTOM', content: '' }],
    ['CUSTOM', '  spaced\n\n\ttabbed\n', { resolution: 'CUSTOM', content: '  spaced\n\n\ttabbed\n' }],
    ['CUSTOM', 'مرحبًا\nبالعالم', { resolution: 'CUSTOM', content: 'مرحبًا\nبالعالم' }],
    ['DELETE', 'ignored', { resolution: 'CUSTOM', content: null }],
    ['DELETE', '', { resolution: 'CUSTOM', content: null }],
  ] as const)('%s with %j sends %j, which the server validator accepts unchanged', (choice, custom, body) => {
    const sent = conflictResolutionBody(choice, custom);
    expect(sent).toStrictEqual(body);
    expect(gitConflictResolutionBody.parse(sent)).toStrictEqual(body);
  });

  it('omits content for the stored sides, and tells an emptied file from a deleted one', () => {
    expect('content' in conflictResolutionBody('OURS', 'x')).toBe(false);
    expect('content' in conflictResolutionBody('THEIRS', 'x')).toBe(false);
    expect(conflictResolutionBody('CUSTOM', '').content).toBe('');
    expect(conflictResolutionBody('DELETE', '').content).toBeNull();
  });
});

describe('isGitConflictResolutionFor', () => {
  const request = { projectId: 'site-a', conflictId: '00000000-0000-4000-8000-000000000001', body: { resolution: 'OURS' } };

  it('matches only the same site and conflict', () => {
    expect(isGitConflictResolutionFor(request, 'site-a', '00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isGitConflictResolutionFor(request, 'site-b', '00000000-0000-4000-8000-000000000001')).toBe(false);
    expect(isGitConflictResolutionFor(request, 'site-a', '00000000-0000-4000-8000-000000000002')).toBe(false);
  });

  it('matches nothing for missing or unrelated variables', () => {
    expect(isGitConflictResolutionFor(undefined, 'site-a', '00000000-0000-4000-8000-000000000001')).toBe(false);
    expect(isGitConflictResolutionFor({ projectId: 'site-a' }, 'site-a', '00000000-0000-4000-8000-000000000001')).toBe(false);
  });
});
