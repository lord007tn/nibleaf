import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { LoaderCircle } from 'lucide-react';

type SiteStatus = 'publishing' | 'live' | 'notPublished';

/** What readers can see right now, from the fields every site in the list carries. */
function siteStatus(site: { publishing?: boolean; live?: boolean }): SiteStatus {
  if (site.publishing) return 'publishing';
  return site.live ? 'live' : 'notPublished';
}

const DOT: Record<SiteStatus, string> = {
  live: 'bg-emerald-500',
  publishing: '',
  notPublished: 'bg-muted-foreground/50',
};

/** A small badge: Live, Publishing… or Not published. The colour is never the only signal. */
export function SiteStatusBadge({ site, className }: { site: { publishing?: boolean; live?: boolean }; className?: string }) {
  const t = useT();
  const status = siteStatus(site);
  return (
    <Badge className={cn('gap-1.5 font-normal', className)} data-status={status} variant="outline">
      {status === 'publishing' ? (
        <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
      ) : (
        <span aria-hidden className={cn('size-1.5 rounded-full', DOT[status])} />
      )}
      {t(`sites.status.${status}`)}
    </Badge>
  );
}
