import { useSiteAccessQuery } from '@/features/site-access/api/use-site-access';
import { decide } from '@/features/site-access/model/access';
import { resolveProjectSettingsAccess, type SiteAdminState, type SiteEditState } from '@/lib/project-settings-access';

/**
 * The signed-in person's {@link SiteAdminState} and {@link SiteEditState} on a site, plus the members
 * query's error and retry so a screen can offer "try again".
 *
 * Someone signed in but missing from the loaded team is `'notAdmin'`: the server
 * only lets members of the site's own team at or above Admin administer it.
 * Cached membership remains usable when a background refetch fails.
 *
 * Shares the members query with any screen that lists the team, so it costs no
 * extra request there.
 */
export function useProjectAdminStatus(projectId: string | undefined) {
  const { access, role, isError, retrying, retry } = useSiteAccessQuery(projectId);
  const content = decide(access, { type: 'site.content.edit' });
  const status: SiteAdminState = resolveProjectSettingsAccess(role, access.status === 'loading' || access.status === 'unavailable');
  const edit: SiteEditState =
    access.status === 'unavailable' ? 'unknown' : content.kind === 'locked' ? 'pending' : content.kind === 'allowed' ? 'edit' : 'viewOnly';
  return { status, edit, role, isError, retrying, retry };
}
