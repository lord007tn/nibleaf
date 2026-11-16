/**
 * Settings → Git → two-way sync → Reconcile conflicts: what one resolution
 * sends, as pure logic.
 *
 * The four buttons send `POST …/git/conflicts/:conflictId/resolve` with one of
 * four bodies (`gitConflictResolutionBody`). Use Nibleaf and Use Git send no
 * content: the server takes the conflict's own stored side. Use custom sends
 * the typed text exactly (an empty string stays an empty string), and Delete
 * file is a custom resolution with `content: null`, which the server stores as
 * a deleted file.
 */
import type { GitConflictResolutionBody } from '@nibleaf/validators';

/** The four buttons, in the order the card shows them. */
export type GitConflictChoice = 'OURS' | 'THEIRS' | 'CUSTOM' | 'DELETE';

/** One resolution: the site and the conflict it is for, and its body. */
export type GitConflictResolutionRequest = { projectId: string; conflictId: string; body: GitConflictResolutionBody };

/** The body a choice sends. `custom` is the custom text as typed; only Use custom reads it. */
export const conflictResolutionBody = (choice: GitConflictChoice, custom: string): GitConflictResolutionBody => {
  if (choice === 'CUSTOM') return { resolution: 'CUSTOM', content: custom };
  if (choice === 'DELETE') return { resolution: 'CUSTOM', content: null };
  return { resolution: choice };
};

/** Whether a resolution request (read from the mutation cache) is for this site's conflict. */
export const isGitConflictResolutionFor = (variables: unknown, projectId: string, conflictId: string) => {
  const request = variables as Partial<GitConflictResolutionRequest> | undefined;
  return request?.projectId === projectId && request.conflictId === conflictId;
};
