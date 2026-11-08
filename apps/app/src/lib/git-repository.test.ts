import { describe, expect, it } from 'vitest';
import { githubRepositoryPath } from './git-repository';

describe('githubRepositoryPath', () => {
  it.each([
    ['team/docs', 'team/docs'],
    ['https://github.com/team/docs', 'team/docs'],
    ['https://github.com/team/docs.git', 'team/docs'],
    ['https://www.github.com/team/my.docs/', 'team/my.docs'],
    ['git@github.com:team/docs.git', 'team/docs'],
  ])('reads %s as %s', (value, expected) => {
    expect(githubRepositoryPath(value)).toBe(expected);
  });

  it.each(['', null, 'https://gitlab.com/team/docs', 'team', 'team/docs/extra'])('rejects %s', (value) => {
    expect(githubRepositoryPath(value)).toBeNull();
  });
});
