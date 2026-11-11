import { useEffect } from 'react';
import { useRecordVisit } from '@/hooks/api';

/** Debounce so quick hops through the switcher record only where the person settles. */
const RECORD_VISIT_DELAY_MS = 1500;

/**
 * Remember the organization (and website) being viewed: the landing org for
 * `/app` and the switcher's Recent list (§5.4.3). Debounced; failures are
 * silent because this is a convenience, never authorization.
 */
export function useRecordVisitEffect(target: { organizationId?: string; projectId?: string }) {
  const { mutate } = useRecordVisit();
  const { organizationId, projectId } = target;
  useEffect(() => {
    if (!organizationId && !projectId) return;
    const timer = setTimeout(() => mutate(projectId ? { projectId } : { organizationId: organizationId ?? '' }), RECORD_VISIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [organizationId, projectId, mutate]);
}
