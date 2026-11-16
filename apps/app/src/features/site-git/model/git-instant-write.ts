/**
 * Site settings → Git: the `git` object an instant write sends (the auto
 * publish switch, Disconnect, and the new connection switching the legacy
 * import off), as pure logic.
 *
 * The settings PATCH replaces the stored `git` wholesale (see
 * `git-connection.ts`), so an instant write sends the site's stored connection
 * back with its one change. It is built from the settings as the server
 * returned them, never from what the tab shows for an unset field and never
 * from the repository form's unsaved draft.
 */
import type { GitProvider, StoredGit } from './git-connection';

/** The one change an instant write makes. */
export type GitInstantChange = { autoPublish: boolean } | { connected: false };

/** The `git` object an instant write sends (`UpdateWorkspaceSettingsBody['git']`). */
export type GitInstantPayload = {
  provider?: GitProvider;
  repo?: string;
  cloneUrl?: string;
  instanceUrl?: string;
  branch?: string;
  path?: string;
  importBranchId?: string;
  importLanguageId?: string;
  connected?: boolean;
  autoPublish?: boolean;
};

const PROVIDERS: readonly GitProvider[] = ['github', 'gitlab', 'git'];
const asText = (value: unknown) => (typeof value === 'string' ? value : undefined);
const filled = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);
const asFlag = (value: unknown) => (typeof value === 'boolean' ? value : undefined);
/** Only the fields that hold a value: an unset one stays unset. */
const present = <T extends Record<string, unknown>>(object: T) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined)) as Partial<T>;

/**
 * The whole `git` object an instant write sends: `stored` (the site's settings
 * as the server returned them) with `change` applied.
 *
 * - The provider as stored. One the settings schema doesn't know is left out
 *   (it couldn't be sent back), and the connection reads as GitHub, as the tab
 *   shows it.
 * - The provider's own address, exactly as stored, as the repository save
 *   sends it: the repository for GitHub and GitLab, the clone URL for a Git
 *   URL, and the instance for GitLab. A blank address is left out (the server
 *   refuses a blank one), and so is another provider's address left from an
 *   earlier save (the repository save clears it too). A stored address the
 *   server would refuse is still sent: the write fails and says so, rather
 *   than deleting it.
 * - The branch, content path, import branch and language, `connected` and
 *   `autoPublish` exactly as stored, a blank or `false` one included. An unset
 *   one stays unset: no display default (`main`, `docs`, `gitlab.com`) is
 *   written for a toggle.
 *
 * Nothing else: the import and push-sync bookkeeping and the webhook secret
 * are the server's to keep, and never sent. A site with no stored connection
 * sends only the change, so it gains no repository and is never connected.
 */
export function gitInstantPayload(stored: (StoredGit & { connected?: unknown }) | null | undefined, change: GitInstantChange): GitInstantPayload {
  const provider = PROVIDERS.find((item) => item === stored?.provider);
  const active = provider ?? 'github';
  return present({
    provider,
    repo: active === 'git' ? undefined : filled(stored?.repo),
    cloneUrl: active === 'git' ? filled(stored?.cloneUrl) : undefined,
    instanceUrl: active === 'gitlab' ? filled(stored?.instanceUrl) : undefined,
    branch: asText(stored?.branch),
    path: asText(stored?.path),
    importBranchId: asText(stored?.importBranchId),
    importLanguageId: asText(stored?.importLanguageId),
    connected: asFlag(stored?.connected),
    autoPublish: asFlag(stored?.autoPublish),
    ...change,
  });
}
