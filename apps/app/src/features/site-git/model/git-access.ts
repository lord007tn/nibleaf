import type { MessageKey } from '@nibleaf/i18n';

/*
 * How Nibleaf reaches a site's GitHub repository (AUTH-25). Today that is one
 * method: a fine-grained personal access token the owner creates on GitHub,
 * described by the constants below. A GitHub App would be a second method:
 * the connect page's access section would offer the methods the server
 * supports, and the repository section would stay as it is.
 */

/** GitHub's page for a new fine-grained token. */
export const GITHUB_NEW_TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/** The repository permissions the token needs, as GitHub names them. */
export const GITHUB_TOKEN_PERMISSIONS: readonly MessageKey[] = [
  'settings.git.connect.permission.contents',
  'settings.git.connect.permission.pullRequests',
  'settings.git.connect.permission.metadata',
];

/** The shortest token worth checking: GitHub's tokens are far longer, so anything shorter is a partial paste. */
export const MIN_TOKEN_LENGTH = 20;

/**
 * Why Connect can't run yet, as the person reads it next to the button, or
 * null when it can: the token is checked first, then the repository and
 * both branches are filled in.
 */
export function connectBlocker(input: { accountChecked: boolean; repository: string; baseBranch: string; headBranch: string }): MessageKey | null {
  if (!input.accountChecked) return 'settings.git.connect.checkFirst';
  if (!input.repository.trim()) return 'settings.git.connect.repositoryFirst';
  if (!input.baseBranch.trim() || !input.headBranch.trim()) return 'settings.git.connect.branchesFirst';
  return null;
}
