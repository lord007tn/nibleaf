import { describe, expect, it } from 'vitest';
import { connectBlocker } from './git-access';

const ready = { accountChecked: true, repository: 'acme/docs', baseBranch: 'main', headBranch: 'nibleaf/docs' };

describe('connectBlocker', () => {
  it('lets Connect run once the token is checked and the repository and branches are filled in', () => {
    expect(connectBlocker(ready)).toBeNull();
  });

  it('asks for the token check first, whatever else is filled in', () => {
    expect(connectBlocker({ ...ready, accountChecked: false })).toBe('settings.git.connect.checkFirst');
    expect(connectBlocker({ ...ready, accountChecked: false, repository: '' })).toBe('settings.git.connect.checkFirst');
  });

  it('then the repository, then both branches; blanks count as empty', () => {
    expect(connectBlocker({ ...ready, repository: '   ' })).toBe('settings.git.connect.repositoryFirst');
    expect(connectBlocker({ ...ready, baseBranch: ' ' })).toBe('settings.git.connect.branchesFirst');
    expect(connectBlocker({ ...ready, headBranch: '' })).toBe('settings.git.connect.branchesFirst');
  });
});
