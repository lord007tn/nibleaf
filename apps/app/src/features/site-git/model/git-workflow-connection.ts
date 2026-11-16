/**
 * Site settings → Git → Connection settings → Connection configuration (the
 * two-way GitHub connection, once connected), as pure logic: the values one
 * draft edits, what the server stores for them, and the body a save sends.
 * Rendered by `components/git-workflow-connection-form.tsx`.
 *
 * `PUT /git/connection` (`connectGitHub`) replaces the whole connection:
 * - it normalizes the repository (`https://github.com/` and `.git` dropped),
 *   both branches (`refs/heads/` dropped) and the content path (`\` → `/`, no
 *   leading or trailing `/`), after the validator trims each;
 * - it writes `importBranchId` and `importLanguageId` as sent, and clears them
 *   when left out. The form never shows them, so a save sends them back
 *   exactly as the latest confirmed status holds them;
 * - it keeps the stored credential unless a token is sent, and always keeps
 *   the webhook secret.
 */

/** The four settings the form edits. */
export type GitWorkflowConnectionValues = {
  repository: string;
  baseBranch: string;
  headBranch: string;
  contentPath: string;
};

/** The connection as the status query returns it. Only the fields read here are typed. */
export type StoredGitWorkflowConnection = GitWorkflowConnectionValues & {
  importBranchId?: string | null;
  importLanguageId?: string | null;
};

export function gitWorkflowConnectionValues(stored: StoredGitWorkflowConnection): GitWorkflowConnectionValues {
  return { repository: stored.repository, baseBranch: stored.baseBranch, headBranch: stored.headBranch, contentPath: stored.contentPath };
}

const branch = (value: string) => value.trim().replace(/^refs\/heads\//, '');

/**
 * What the server stores for `values` and reads back; the draft's `toSent`.
 * Mirrors `connectGitHub`. A value the server refuses fails the save, so it
 * never needs a stored form.
 */
export function sentGitWorkflowConnectionValues(values: GitWorkflowConnectionValues): GitWorkflowConnectionValues {
  return {
    repository: values.repository
      .trim()
      .replace(/^https:\/\/github\.com\//i, '')
      .replace(/\.git$/i, ''),
    baseBranch: branch(values.baseBranch),
    headBranch: branch(values.headBranch),
    contentPath: values.contentPath
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, ''),
  };
}

/** The body of `PUT /git/connection` (`GitConnectionBody`). */
export type GitWorkflowConnectionPayload = GitWorkflowConnectionValues & {
  importBranchId?: string;
  importLanguageId?: string;
  token?: string;
};

/** The token a save sends: one the person typed, never a blank one (blank keeps the stored credential). */
export function gitWorkflowTokenToSend(token: string): string | undefined {
  return token.trim() ? token : undefined;
}

/**
 * The whole body a connection save sends, since the PUT replaces the
 * connection:
 * - the four settings as typed (the server trims and normalizes them);
 * - the import branch and language exactly as `stored` (the latest confirmed
 *   status) holds them, left out only where it holds none;
 * - the token only when one was typed.
 */
export function gitWorkflowConnectionPayload(
  values: GitWorkflowConnectionValues,
  stored: StoredGitWorkflowConnection | null | undefined,
  token = '',
): GitWorkflowConnectionPayload {
  const sentToken = gitWorkflowTokenToSend(token);
  return {
    repository: values.repository,
    baseBranch: values.baseBranch,
    headBranch: values.headBranch,
    contentPath: values.contentPath,
    ...(stored?.importBranchId ? { importBranchId: stored.importBranchId } : {}),
    ...(stored?.importLanguageId ? { importLanguageId: stored.importLanguageId } : {}),
    ...(sentToken ? { token: sentToken } : {}),
  };
}

/** The settings a save needs filled in. */
export type GitWorkflowConnectionField = 'repository' | 'baseBranch' | 'headBranch';
const REQUIRED: readonly GitWorkflowConnectionField[] = ['repository', 'baseBranch', 'headBranch'];

/** The required settings left blank, in form order. The server refuses a blank one; saying so here keeps the request. */
export function missingGitWorkflowConnectionFields(values: GitWorkflowConnectionValues): GitWorkflowConnectionField[] {
  return REQUIRED.filter((field) => !values[field].trim());
}
