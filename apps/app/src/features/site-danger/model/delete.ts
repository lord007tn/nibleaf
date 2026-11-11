/**
 * Deleting a website, the parts that are pure decisions.
 *
 * A delete can commit on the server while its response is lost (a dropped
 * connection, a gateway timeout), and a retry then answers "not found". So a
 * failure that doesn't prove the website still exists is checked against the
 * websites the person can see before it is reported.
 */

/**
 * Whether a failed delete might have happened anyway: no HTTP status (the
 * request or its response was lost), a timeout, a server error, or "not
 * found" (already gone). A refusal the server decided (400, 401, 403, 409…)
 * means nothing was deleted.
 */
export function deleteMayHaveHappened(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'status' in error ? (error as { status: unknown }).status : undefined;
  if (typeof status !== 'number') return true;
  return status === 404 || status === 408 || status >= 500;
}

/** Whether the website is gone from a list of the websites the person can see. */
export const websiteIsGone = (websites: ReadonlyArray<{ id: string }>, websiteId: string) => !websites.some((website) => website.id === websiteId);

/**
 * Whether a delete's completion may still act (toast, navigate): only for the
 * same dialog run, the same signed-in person, and a page that is still there.
 */
export const completionStillApplies = (
  start: { run: number; userId: string | undefined },
  now: { run: number; userId: string | undefined; mounted: boolean },
) => now.mounted && now.run === start.run && now.userId === start.userId;
