import { useT } from '@nibleaf/i18n/react';
import type { Decision as SiteDecision } from '@/features/site-access/model/access';
import type { Decision } from '../model/permissions';

/** Turns a model decision into the `disabledReason` a control takes: undefined
 *  when allowed. Accepts the org model's Decision and the shared site-access one
 *  (where `locked` means access is still loading or could not be checked). */
export function useReason() {
  const t = useT();
  return (decision: Decision | SiteDecision) => {
    if ('allowed' in decision) return decision.allowed ? undefined : t(decision.reason);
    if (decision.kind === 'allowed') return;
    return decision.kind === 'denied' ? t(decision.reason) : t('access.unknown.title');
  };
}
