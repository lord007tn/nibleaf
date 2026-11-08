import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SkeletonListRow } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale, useT } from '@nibleaf/i18n/react';
import { MemberRole } from '@nibleaf/shared/constants';
import { normalizeEmailDomain } from '@nibleaf/shared/join-links';
import type { AssignableMemberRole } from '@nibleaf/shared/rbac';
import { ChevronDown, Copy, Link2, Plus, RefreshCw, X } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { RoleSelect } from '@/components/members/role-select';
import { QueryErrorState } from '@/components/query-error-state';
import { friendlyErrorMessage, type JoinLink, useCreateJoinLink, useJoinLinks, useRegenerateJoinLink, useRevokeJoinLink } from '@/hooks/api';
import { copyToClipboard } from '@/lib/invitations';
import { roleLabelKey } from '@/lib/member-roles';

const EXPIRY_OPTIONS = [
  { value: 'never', days: undefined, label: 'settings.joinLinks.expiry.never' },
  { value: '1', days: 1, label: 'settings.joinLinks.expiry.d1' },
  { value: '7', days: 7, label: 'settings.joinLinks.expiry.d7' },
  { value: '30', days: 30, label: 'settings.joinLinks.expiry.d30' },
  { value: '90', days: 90, label: 'settings.joinLinks.expiry.d90' },
] as const satisfies ReadonlyArray<{ value: string; days: number | undefined; label: MessageKey }>;

const STATUS_COPY: Record<JoinLink['status'], { label: MessageKey; tone: string }> = {
  active: { label: 'settings.joinLinks.status.active', tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  revoked: { label: 'settings.joinLinks.status.revoked', tone: 'border-border bg-muted text-muted-foreground' },
  expired: { label: 'settings.joinLinks.status.expired', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
  used_up: { label: 'settings.joinLinks.status.usedUp', tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400' },
};

/** The link just created or regenerated. Shown once: only its hash is stored. */
type FreshLink = { id: string; url: string };

/**
 * Join links for one site: create (role, expiry, max people, email domain),
 * copy once, regenerate, disable, and see who joined. Admins only (the page
 * renders it for them; the API enforces it).
 */
export function JoinLinksSection({ projectId }: { projectId: string }) {
  const t = useT();
  const confirm = useConfirm();
  const links = useJoinLinks(projectId);
  const create = useCreateJoinLink(projectId);
  const regenerate = useRegenerateJoinLink(projectId);
  const revoke = useRevokeJoinLink(projectId);
  const [formOpen, setFormOpen] = useState(false);
  const [fresh, setFresh] = useState<FreshLink | null>(null);

  const onRegenerate = async (link: JoinLink) => {
    const ok = await confirm({
      title: t('settings.joinLinks.regenerateConfirmTitle'),
      description: t('settings.joinLinks.regenerateConfirm'),
      confirmLabel: t('settings.joinLinks.regenerate'),
      destructive: true,
    });
    if (!ok) return;
    regenerate.mutate(link.id, {
      onSuccess: (result) => {
        setFresh({ id: result.link.id, url: result.url });
        toast.success(t('settings.joinLinks.toast.regenerated'));
      },
      onError: (error) => toast.error(friendlyErrorMessage(t, error, 'settings.joinLinks.toast.error')),
    });
  };

  const onDisable = async (link: JoinLink) => {
    const ok = await confirm({
      title: t('settings.joinLinks.disableConfirmTitle'),
      description: t('settings.joinLinks.disableConfirm'),
      confirmLabel: t('settings.joinLinks.disable'),
      destructive: true,
    });
    if (!ok) return;
    revoke.mutate(link.id, {
      onSuccess: () => {
        setFresh((current) => (current?.id === link.id ? null : current));
        toast.success(t('settings.joinLinks.toast.disabled'));
      },
      onError: (error) => toast.error(friendlyErrorMessage(t, error, 'settings.joinLinks.toast.error')),
    });
  };

  return (
    <section aria-labelledby="join-links-heading" className="mt-10" data-testid="join-links">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-semibold text-[15px]" id="join-links-heading">
            <Link2 aria-hidden className="size-4" /> {t('settings.joinLinks.title')}
          </h3>
          <p className="mt-1 max-w-prose text-muted-foreground text-sm">{t('settings.joinLinks.description')}</p>
        </div>
        {formOpen ? null : (
          <Button onClick={() => setFormOpen(true)} size="sm" variant="outline">
            <Plus className="size-4" /> {t('settings.joinLinks.create')}
          </Button>
        )}
      </div>

      {formOpen ? (
        <CreateJoinLinkForm
          creating={create.isPending}
          onCancel={() => setFormOpen(false)}
          onCreate={(body) =>
            create.mutate(body, {
              onSuccess: (result) => {
                setFresh({ id: result.link.id, url: result.url });
                setFormOpen(false);
                toast.success(t('settings.joinLinks.toast.created'));
              },
              onError: (error) => toast.error(friendlyErrorMessage(t, error, 'settings.joinLinks.toast.error')),
            })
          }
        />
      ) : null}

      {fresh ? <FreshLinkCard link={fresh} onDismiss={() => setFresh(null)} /> : null}

      {links.isPending ? (
        <div aria-busy="true">
          <p className="sr-only" role="status">
            {t('common.loading')}
          </p>
          <SkeletonListRow />
          <SkeletonListRow />
        </div>
      ) : links.isError && !links.data ? (
        <QueryErrorState onRetry={() => void links.refetch()} retrying={links.isFetching} />
      ) : (links.data ?? []).length === 0 ? (
        <p className="rounded-xl border border-border border-dashed px-4 py-6 text-center text-muted-foreground text-sm">
          {t('settings.joinLinks.empty')}
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {(links.data ?? []).map((link) => (
            <JoinLinkRow
              busy={(regenerate.isPending && regenerate.variables === link.id) || (revoke.isPending && revoke.variables === link.id)}
              key={link.id}
              link={link}
              onDisable={() => void onDisable(link)}
              onRegenerate={() => void onRegenerate(link)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FreshLinkCard({ link, onDismiss }: { link: FreshLink; onDismiss: () => void }) {
  const t = useT();
  return (
    <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-3.5" data-testid="join-link-fresh" role="status">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-[13px]">{t('settings.joinLinks.createdTitle')}</p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">{t('settings.joinLinks.createdHint')}</p>
        </div>
        <Button aria-label={t('settings.members.dismiss')} onClick={onDismiss} size="icon-sm" variant="ghost">
          <X className="size-4" />
        </Button>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label={t('settings.members.copyLink')}
          className="min-w-0 flex-1 font-mono text-sm"
          dir="ltr"
          onFocus={(event) => event.currentTarget.select()}
          readOnly
          value={link.url}
        />
        <Button
          onClick={async () => {
            const ok = await copyToClipboard(link.url);
            toast[ok ? 'success' : 'error'](t(ok ? 'settings.members.linkCopied' : 'settings.members.copyFailed'));
          }}
          type="button"
        >
          <Copy className="size-4" /> {t('settings.members.copyLink')}
        </Button>
      </div>
    </div>
  );
}

function JoinLinkRow({ link, busy, onRegenerate, onDisable }: { link: JoinLink; busy: boolean; onRegenerate: () => void; onDisable: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const usesId = useId();
  const status = STATUS_COPY[link.status];
  const date = (value: string | Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value));
  const facts = [
    t('settings.joinLinks.joinsAs', { role: t(roleLabelKey(link.role)) }),
    link.maxUses === null
      ? t('settings.joinLinks.usesUnlimited', { used: link.useCount })
      : t('settings.joinLinks.uses', { used: link.useCount, max: link.maxUses }),
    link.expiresAt ? t('settings.joinLinks.expiresOn', { date: date(link.expiresAt) }) : t('settings.joinLinks.noExpiry'),
    ...(link.allowedDomain ? [t('settings.joinLinks.domainOnly', { domain: link.allowedDomain })] : []),
  ];
  return (
    <li className="px-3.5 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        {/* At least 14rem wide, so on a phone the actions wrap below the details. */}
        <div className="min-w-[14rem] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-[13.5px]" dir="auto">
              {link.label || t('settings.joinLinks.untitled')}
            </span>
            <span className={cn('rounded-md border px-1.5 py-0.5 font-medium text-[11px]', status.tone)}>{t(status.label)}</span>
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">{facts.join(' · ')}</p>
          <p className="text-[12px] text-muted-foreground" dir="auto">
            {t('settings.joinLinks.createdBy', { name: link.createdBy?.name || link.createdBy?.email || '—', date: date(link.createdAt) })}
          </p>
        </div>
        {link.status === 'revoked' ? null : (
          <div className="flex shrink-0 items-center gap-1">
            <Button loading={busy} onClick={onRegenerate} size="sm" variant="ghost">
              <RefreshCw className="size-3.5" /> {t('settings.joinLinks.regenerate')}
            </Button>
            <Button className="text-destructive hover:text-destructive" disabled={busy} onClick={onDisable} size="sm" variant="ghost">
              {t('settings.joinLinks.disable')}
            </Button>
          </div>
        )}
      </div>
      <button
        aria-controls={usesId}
        aria-expanded={open}
        className="mt-2 inline-flex items-center gap-1 text-[12px] text-primary hover:underline"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <ChevronDown aria-hidden className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
        {t('settings.joinLinks.recentJoins')} ({link.useCount})
      </button>
      {open ? (
        <ul className="mt-2 space-y-1" id={usesId}>
          {link.uses.length === 0 ? <li className="text-[12px] text-muted-foreground">{t('settings.joinLinks.noJoins')}</li> : null}
          {link.uses.map((use) => (
            <li className="flex flex-wrap items-center justify-between gap-2 text-[12px]" key={use.id}>
              <span className="min-w-0 truncate" dir="auto">
                {use.user?.name ? `${use.user.name} · ` : ''}
                <span className="text-muted-foreground">{use.user?.email ?? use.email}</span>
              </span>
              <span className="text-muted-foreground">
                {t(roleLabelKey(use.role))} · {date(use.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CreateJoinLinkForm({
  creating,
  onCreate,
  onCancel,
}: {
  creating: boolean;
  onCreate: (body: { label?: string; role: AssignableMemberRole; expiresInDays?: number; maxUses?: number; allowedDomain?: string }) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const ids = { label: useId(), expiry: useId(), maxUses: useId(), domain: useId(), domainError: useId() };
  const [label, setLabel] = useState('');
  const [role, setRole] = useState<AssignableMemberRole>(MemberRole.MEMBER);
  const [expiry, setExpiry] = useState<(typeof EXPIRY_OPTIONS)[number]['value']>('7');
  const [maxUses, setMaxUses] = useState('');
  const [domain, setDomain] = useState('');
  const domainInvalid = domain.trim() !== '' && normalizeEmailDomain(domain) === null;
  const maxUsesValue = maxUses.trim() === '' ? undefined : Number(maxUses);
  const maxUsesInvalid = maxUsesValue !== undefined && !(Number.isInteger(maxUsesValue) && maxUsesValue >= 1 && maxUsesValue <= 10_000);
  const expiryItems = EXPIRY_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }));

  return (
    <form
      className="mb-4 grid gap-3 rounded-xl bg-muted/30 p-3.5 sm:grid-cols-2"
      data-testid="join-link-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (domainInvalid || maxUsesInvalid) return;
        onCreate({
          label: label.trim() || undefined,
          role,
          expiresInDays: EXPIRY_OPTIONS.find((option) => option.value === expiry)?.days,
          maxUses: maxUsesValue,
          allowedDomain: domain.trim() ? (normalizeEmailDomain(domain) ?? undefined) : undefined,
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label className="font-medium text-[13px]" htmlFor={ids.label}>
          {t('settings.joinLinks.labelField')}
        </Label>
        <Input
          className="bg-background"
          id={ids.label}
          maxLength={60}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t('settings.joinLinks.labelPlaceholder')}
          value={label}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-[13px]">{t('settings.joinLinks.roleField')}</span>
        <RoleSelect ariaLabel={t('settings.joinLinks.roleField')} className="w-full bg-background" onValueChange={setRole} value={role} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="font-medium text-[13px]" htmlFor={ids.expiry}>
          {t('settings.joinLinks.expiryField')}
        </Label>
        <Select items={expiryItems} onValueChange={(next) => next && setExpiry(next as typeof expiry)} value={expiry}>
          <SelectTrigger className="w-full bg-background" id={ids.expiry}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {expiryItems.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="font-medium text-[13px]" htmlFor={ids.maxUses}>
          {t('settings.joinLinks.maxUsesField')}
        </Label>
        <Input
          aria-invalid={maxUsesInvalid}
          className="bg-background"
          id={ids.maxUses}
          inputMode="numeric"
          max={10_000}
          min={1}
          onChange={(event) => setMaxUses(event.target.value)}
          placeholder={t('settings.joinLinks.maxUsesPlaceholder')}
          type="number"
          value={maxUses}
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:col-span-2">
        <Label className="font-medium text-[13px]" htmlFor={ids.domain}>
          {t('settings.joinLinks.domainField')}
        </Label>
        <Input
          aria-describedby={domainInvalid ? ids.domainError : undefined}
          aria-invalid={domainInvalid}
          className="bg-background"
          dir="ltr"
          id={ids.domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder={t('settings.joinLinks.domainPlaceholder')}
          value={domain}
        />
        {domainInvalid ? (
          <p className="text-destructive text-xs" id={ids.domainError}>
            {t('settings.joinLinks.domainInvalid')}
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">{t('settings.joinLinks.verifiedHint')}</p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <Button onClick={onCancel} type="button" variant="ghost">
          {t('common.cancel')}
        </Button>
        <Button disabled={domainInvalid || maxUsesInvalid} loading={creating} type="submit">
          <Link2 className="size-4" /> {t('settings.joinLinks.create')}
        </Button>
      </div>
    </form>
  );
}
