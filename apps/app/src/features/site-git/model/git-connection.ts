/**
 * Site settings → Git → Repository settings (the legacy one-way import), as
 * pure logic: the repository connection one draft edits, and the `git` object
 * a save sends. Rendered by `components/git-connection-form.tsx`.
 *
 * The settings PATCH replaces the stored `git` wholesale with what it was sent
 * (after `gitConfigSchema`), and carries over only the import and push-sync
 * bookkeeping (`lastImportedAt`, `lastSyncAt`, `lastSyncStatus`,
 * `lastSyncError`); the webhook secret is kept apart and never sent. So a save
 * must send every client field it means to keep: the connection itself, and
 * `connected` and `autoPublish`, which other controls own.
 */

export type GitProvider = 'github' | 'gitlab' | 'git';
const PROVIDERS: readonly GitProvider[] = ['github', 'gitlab', 'git'];

/** What an unset field shows, and what a blank one is saved as where the server needs a value. */
const GIT_DEFAULTS = { provider: 'github', instanceUrl: 'https://gitlab.com', branch: 'main', path: 'docs' } as const;

/** The site's `git` settings as the settings query returns them. Only the fields read here are typed. */
export type StoredGit = {
  provider?: unknown;
  repo?: unknown;
  cloneUrl?: unknown;
  instanceUrl?: unknown;
  branch?: unknown;
  path?: unknown;
  importBranchId?: unknown;
  importLanguageId?: unknown;
  autoPublish?: unknown;
};

/**
 * The connection the form edits: the provider and its seven fields, one draft
 * per site. Every field keeps its text while another provider is picked, so
 * switching back restores it; a save sends only the picked provider's fields.
 */
export type GitConnectionValues = {
  provider: GitProvider;
  repo: string;
  cloneUrl: string;
  instanceUrl: string;
  branch: string;
  path: string;
  importBranchId: string;
  importLanguageId: string;
};

const text = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);

/** The stored connection as the form shows it: an unset field shows its default (a blank one stays blank). */
export function gitConnectionValues(git: StoredGit | null | undefined): GitConnectionValues {
  const provider = PROVIDERS.find((item) => item === git?.provider) ?? GIT_DEFAULTS.provider;
  return {
    provider,
    repo: text(git?.repo),
    cloneUrl: text(git?.cloneUrl),
    instanceUrl: text(git?.instanceUrl, GIT_DEFAULTS.instanceUrl),
    branch: text(git?.branch, GIT_DEFAULTS.branch),
    path: text(git?.path, GIT_DEFAULTS.path),
    importBranchId: text(git?.importBranchId),
    importLanguageId: text(git?.importLanguageId),
  };
}

/**
 * The values a save of `values` stores, read back as the form reads them; the
 * draft's `toSent`. The picked provider's address is trimmed and the others'
 * are cleared (an unset GitLab instance reads back as the default), a blank
 * branch is saved as `main`, and the content path is trimmed.
 */
export function sentGitConnectionValues(values: GitConnectionValues): GitConnectionValues {
  const { provider } = values;
  return {
    provider,
    repo: provider === 'git' ? '' : values.repo.trim(),
    cloneUrl: provider === 'git' ? values.cloneUrl.trim() : '',
    instanceUrl: (provider === 'gitlab' && values.instanceUrl.trim()) || GIT_DEFAULTS.instanceUrl,
    branch: values.branch.trim() || GIT_DEFAULTS.branch,
    path: values.path.trim(),
    importBranchId: values.importBranchId,
    importLanguageId: values.importLanguageId,
  };
}

/** The `git` object a repository save sends (`UpdateWorkspaceSettingsBody['git']`). */
export type GitConnectionPayload = {
  provider: GitProvider;
  repo?: string;
  cloneUrl?: string;
  instanceUrl?: string;
  branch: string;
  path: string;
  importBranchId?: string;
  importLanguageId?: string;
  connected: true;
  autoPublish?: boolean;
};

/**
 * The whole `git` object a repository save sends, since the PATCH replaces it:
 * - the picked provider's fields as `sentGitConnectionValues` stores them; the
 *   other providers' addresses and an unpicked import branch or language are
 *   left out, which clears them;
 * - `connected: true`: saving the repository connects it;
 * - `autoPublish` exactly as `stored` (the server's latest settings) holds it,
 *   and left out when unset, so a repository save never switches it.
 *
 * Nothing else: the import and push-sync bookkeeping and the webhook secret
 * are the server's to keep.
 */
export function gitConnectionPayload(values: GitConnectionValues, stored: StoredGit | null | undefined): GitConnectionPayload {
  const sent = sentGitConnectionValues(values);
  return {
    provider: sent.provider,
    ...(sent.provider === 'git' ? { cloneUrl: sent.cloneUrl } : { repo: sent.repo }),
    ...(sent.provider === 'gitlab' ? { instanceUrl: sent.instanceUrl } : {}),
    branch: sent.branch,
    path: sent.path,
    ...(sent.importBranchId ? { importBranchId: sent.importBranchId } : {}),
    ...(sent.importLanguageId ? { importLanguageId: sent.importLanguageId } : {}),
    connected: true,
    ...(typeof stored?.autoPublish === 'boolean' ? { autoPublish: stored.autoPublish } : {}),
  };
}

/** The field a save needs filled in: the repository path, or the clone URL for a plain Git URL. */
export type GitConnectionField = 'repo' | 'cloneUrl';

/** The required field left blank, if any. The server refuses a blank one; saying so here keeps the request. */
export function missingGitConnectionField(values: GitConnectionValues): GitConnectionField | undefined {
  const field: GitConnectionField = values.provider === 'git' ? 'cloneUrl' : 'repo';
  return values[field].trim() ? undefined : field;
}
