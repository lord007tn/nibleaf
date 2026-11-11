import { Avatar, AvatarFallback, AvatarImage } from '@nibleaf/design-system/components/ui/avatar';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import type { ReactNode } from 'react';
import type { WebsiteAccess } from '../model/members';
import type { PersonDisplay } from '../model/person';
import { siteRoleLabel } from '../model/roles';

function PersonAvatar({ person, image, className }: { person: PersonDisplay; image?: string | null; className?: string }) {
  return (
    <Avatar className={cn('size-8 shrink-0', className)}>
      {image ? <AvatarImage alt="" src={image} /> : null}
      <AvatarFallback className="font-medium text-xs">{person.initials}</AvatarFallback>
    </Avatar>
  );
}

/** "You" next to the signed-in person's own row. */
function YouBadge() {
  const t = useT();
  return (
    <Badge className="h-5 px-1.5 font-normal text-xs" variant="secondary">
      {t('people.you')}
    </Badge>
  );
}

/**
 * A person as every people list shows them: avatar (initials from the name or
 * the email), the name or, without one, the email as the primary line, and the
 * email underneath only when it isn't already the primary line.
 */
export function PersonCell({
  person,
  image,
  isYou,
  extra,
  title,
}: {
  person: PersonDisplay;
  image?: string | null;
  isYou?: boolean;
  /** Small line under the email (e.g. the website chips on a phone). */
  extra?: ReactNode;
  /** Replaces the primary text, e.g. with a button that opens the access sheet. */
  title?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <PersonAvatar image={image} person={person} />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="min-w-0 break-words font-medium text-sm">
            {title ?? <bdi dir={person.secondary ? 'auto' : 'ltr'}>{person.primary}</bdi>}
          </span>
          {isYou ? <YouBadge /> : null}
        </div>
        {person.secondary ? (
          <div className="min-w-0 truncate text-muted-foreground text-xs">
            <bdi dir="ltr">{person.secondary}</bdi>
          </div>
        ) : null}
        {extra}
      </div>
    </div>
  );
}

/** "All websites", "No websites yet", or a couple of website chips with their role, then "+N". */
export function WebsiteAccessSummary({ access }: { access: WebsiteAccess }) {
  const t = useT();
  if (access.kind === 'all') return <span className="text-sm">{t('people.access.all')}</span>;
  if (access.kind === 'none') return <span className="text-muted-foreground text-sm">{t('people.access.none')}</span>;
  const rest = access.all.slice(access.chips.length);
  return (
    <ul aria-label={t('people.access.label')} className="flex min-w-0 flex-wrap items-center gap-1">
      {access.chips.map((chip) => (
        <li key={chip.projectId}>
          <Badge className="max-w-40 gap-1 font-normal" variant="outline">
            <bdi className="min-w-0 truncate">{chip.name}</bdi>
            <span className="text-muted-foreground">· {t(siteRoleLabel(chip.role))}</span>
          </Badge>
        </li>
      ))}
      {access.overflow ? (
        <li>
          <Badge className="font-normal" title={rest.map((chip) => `${chip.name} (${t(siteRoleLabel(chip.role))})`).join(', ')} variant="secondary">
            <span aria-hidden>+{access.overflow}</span>
            <span className="sr-only">{t('people.access.more', { count: access.overflow, names: rest.map((chip) => chip.name).join(', ') })}</span>
          </Badge>
        </li>
      ) : null}
    </ul>
  );
}

/** A count next to a section title ("Pending invitations 3"). Hidden from nobody: it is part of the heading text. */
export function Count({ value }: { value: number }) {
  return (
    <span className="ms-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 align-middle font-medium text-muted-foreground text-xs tabular-nums">
      {value}
    </span>
  );
}
