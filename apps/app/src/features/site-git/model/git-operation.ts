/**
 * Site settings → Git → Sync and Update PR: the operation request each press
 * sends, as pure logic. Driven by `components/use-git-operation-command.ts`;
 * tested in `git-operation.test.ts`.
 *
 * The bodies are main's, field for field: nothing is trimmed, defaulted or
 * checked here, and the server's validator stays the authority on them.
 */
import type { GitOperationBody } from '@nibleaf/validators';

/** The connected screen's two operation panels. */
export type GitOperationPanel = 'sync' | 'publish';

/** Update PR's fields as they were when it was pressed. */
export type GitUpdatePrFields = {
  commitMessage: string;
  authorName: string;
  authorEmail: string;
  pullRequestTitle: string;
};

/** An operation as sent. It names the site it is for, whatever the page shows by the time it settles. */
export type GitOperationRequest = { projectId: string; body: GitOperationBody };

/** Sync: pull the connection's base branch into the site. */
export const gitSyncRequest = (projectId: string, idempotencyKey: string, baseBranch: string): GitOperationRequest => ({
  projectId,
  body: { idempotencyKey, kind: 'PULL', sourceRef: baseBranch },
});

/** Update PR: push the site's content and open or update its pull request. */
export const gitUpdatePrRequest = (projectId: string, idempotencyKey: string, fields: GitUpdatePrFields): GitOperationRequest => ({
  projectId,
  body: {
    idempotencyKey,
    kind: 'PUSH',
    commitMessage: fields.commitMessage,
    authorName: fields.authorName,
    authorEmail: fields.authorEmail,
    createPullRequest: true,
    pullRequestTitle: fields.pullRequestTitle,
  },
});

/** Whether a pending request (as the mutation cache holds it) is for this site. */
export const isGitOperationFor = (variables: unknown, projectId: string): boolean =>
  typeof variables === 'object' && variables !== null && (variables as Record<string, unknown>).projectId === projectId;
