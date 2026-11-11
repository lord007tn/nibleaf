import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/app/empty-state';

/** An Owner/Admin-only org page seen by a Member, or after a demotion while viewing (§5.4.6). */
export function AdminRequired({ orgSlug }: { orgSlug: string }) {
  const t = useT();
  return (
    <EmptyState
      action={
        <Button nativeButton={false} render={<Link params={{ orgSlug }} to="/app/o/$orgSlug/websites" />} variant="outline">
          {t('nav.websites')}
        </Button>
      }
      description={t('organization.adminRequired.body')}
      framed
      icon={<ShieldAlert />}
      title={t('organization.adminRequired.title')}
    />
  );
}
