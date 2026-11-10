import { useT } from '@nibleaf/i18n/react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { toast } from 'sonner';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { organizationKeys } from '@/hooks/api/organization-keys';
import { queryKeys } from '@/hooks/api/query-keys';

/** The server hides what you cannot open (404; 403 for a page you lost the role for). */
export const isAccessLoss = (error: unknown) => error instanceof ApiResponseError && (error.status === 404 || error.status === 403);

/**
 * Removal while you're looking (§5.4.6): leave the page for your landing org
 * (or the org's Websites for a lost website) with a toast naming what was lost.
 * The name always comes from the client cache, never from the server.
 */
export function useAccessLoss() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refresh = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationKeys.me.switcher() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications.list() }),
      ]),
    [queryClient],
  );
  const lostOrganization = useCallback(
    (name: string) => {
      toast.info(t('organization.lostAccess', { name }), { id: `lost-organization-${name}` });
      void refresh();
      void navigate({ to: '/app', replace: true });
    },
    [navigate, refresh, t],
  );
  const lostWebsite = useCallback(
    (name: string, orgSlug: string | undefined) => {
      toast.info(t('organization.lostWebsiteAccess', { name }), { id: `lost-website-${name}` });
      void refresh();
      if (orgSlug) void navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug }, replace: true });
      else void navigate({ to: '/app', replace: true });
    },
    [navigate, refresh, t],
  );
  return { lostOrganization, lostWebsite };
}
