/**
 * The one notice the Reader questions page shows, if any (operations/ui-overhaul.md
 * §6.6: one per page, WORKSPACE-02). Pure, so the order is tested:
 * - `unavailable`: this server keeps no question history at all. The page's whole
 *   body (filters, tabs, figures) is replaced, since nothing on it could work.
 * - `outage`: the history couldn't be read just now; retry in place.
 * - `notSaving`: new questions aren't saved, by the site's choice (`site`, with a
 *   link to the setting) or because history isn't on yet (`instance`). Questions
 *   saved earlier still show under it.
 */
export type AiPageNotice = { kind: 'unavailable' } | { kind: 'outage' } | { kind: 'notSaving'; reason: 'site' | 'instance' } | null;

export function aiPageNotice(input: {
  availability: string | undefined;
  failed: boolean;
  captureEnabled: boolean | undefined;
  captureOffReason: string | null | undefined;
}): AiPageNotice {
  if (input.availability === 'disabled') return { kind: 'unavailable' };
  if (input.failed || input.availability === 'unavailable') return { kind: 'outage' };
  if (input.captureEnabled === false) return { kind: 'notSaving', reason: input.captureOffReason === 'instance' ? 'instance' : 'site' };
  return null;
}
