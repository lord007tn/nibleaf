/** URL handles an organization may never take (they are app route segments).
 *  Mirrors the `organization_handle_slug_check` constraint (design §3). */
export const RESERVED_ORGANIZATION_HANDLES: ReadonlySet<string> = new Set(['new', 'settings', 'welcome', 'o', 'api', 'app', 'admin']);

/** Longest handle base before a `-2`, `-3`… suffix. */
export const MAX_ORGANIZATION_HANDLE_BASE = 48;

export const ORGANIZATION_HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const isValidOrganizationHandle = (slug: string) => ORGANIZATION_HANDLE_PATTERN.test(slug) && !RESERVED_ORGANIZATION_HANDLES.has(slug);

/**
 * The base handle for a new organization, exactly like the PR 1 backfill:
 * ASCII-lowercase the name, collapse every other run to `-`, cap at 48. An
 * empty result (an Arabic-only name, for example) or a reserved word becomes
 * `org-<first 6 chars of the id>`.
 */
export const organizationHandleBase = (name: string, organizationId: string) => {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ORGANIZATION_HANDLE_BASE)
    .replace(/-+$/g, '');
  return base && !RESERVED_ORGANIZATION_HANDLES.has(base) ? base : `org-${organizationId.slice(0, 6).toLowerCase()}`;
};

/** Candidates in order: `base`, `base-2`, `base-3`… The caller takes the first
 *  one no `OrganizationHandle` row (current or alias) holds. */
export function* organizationHandleCandidates(name: string, organizationId: string): Generator<string> {
  const base = organizationHandleBase(name, organizationId);
  yield base;
  for (let suffix = 2; ; suffix++) yield `${base}-${suffix}`;
}
