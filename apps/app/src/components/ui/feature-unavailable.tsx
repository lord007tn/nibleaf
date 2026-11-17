import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import type { ReactNode } from 'react';

/**
 * A feature this server, plan or person can't use right now, in place of the
 * feature's whole body: one plain sentence and why, never a form that can't
 * save (operations/ui-overhaul.md §6.6). One per page; for part of a page use a
 * `Callout`. The words never name operators, encryption keys or self-hosting:
 * the caller chooses them for the person reading.
 */
export function FeatureUnavailable({
  reason,
  icon,
  title,
  description,
  action,
}: {
  reason: 'notConfigured' | 'notOnPlan' | 'needsAdmin' | 'comingSoon';
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return <EmptyState action={action} data-reason={reason} description={description} headingLevel={2} icon={icon} title={title} />;
}
