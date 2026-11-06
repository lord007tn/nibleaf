import { Button } from '@nibleaf/design-system/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@nibleaf/design-system/components/ui/collapsible';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { cn } from '@nibleaf/design-system/lib/utils';
import { getLocale } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Check, ChevronDown, Copy, ExternalLink, Globe2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { getDomain } from 'tldts';
import { QueryErrorState } from '@/components/query-error-state';
import type { Project } from '@/hooks/api';
import { useAddDomain, useDeleteDomain, useDomains, useSetPrimaryDomain, useVerifyDomain } from '@/hooks/api';
import { localeTag } from '@/lib/format';
import { copyToClipboard } from '@/lib/invitations';
import { DirtyStateReporter, FIELD_MONO, SectionHeader, SettingsFormSkeleton } from './shared';

export function DomainSection({ project }: { project: Project }) {
  const t = useT();
  const confirm = useConfirm();
  const query = useDomains(project.id);
  const { data: domains } = query;
  const add = useAddDomain(project.id);
  const verify = useVerifyDomain(project.id);
  const setPrimary = useSetPrimaryDomain(project.id);
  const remove = useDeleteDomain(project.id);
  const removeDomain = async (id: string, name: string) => {
    const ok = await confirm({
      title: t('settings.domain.remove'),
      description: t('settings.domain.removeConfirm', { domain: name }),
      confirmLabel: t('settings.domain.remove'),
      destructive: true,
    });
    if (ok) {
      remove.mutate(id);
    }
  };
  const [domain, setDomain] = useState('');
  const [copyingRecord, setCopyingRecord] = useState<string | null>(null);
  const [copiedRecord, setCopiedRecord] = useState<string | null>(null);

  const list = domains ?? [];
  const copyRecord = async (key: string, text: string) => {
    setCopyingRecord(key);
    const ok = await copyToClipboard(text);
    setCopyingRecord(null);
    if (!ok) {
      toast.error(t('settings.domain.dns.copyFailed'));
      return;
    }
    setCopiedRecord(key);
    toast.success(t('settings.domain.dns.copied'));
    window.setTimeout(() => setCopiedRecord((current) => (current === key ? null : current)), 1600);
  };

  if (query.isError && !domains) return <QueryErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  if (query.isPending) return <SettingsFormSkeleton />;
  return (
    <div>
      {query.isError ? <QueryErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} /> : null}
      <DirtyStateReporter dirty={Boolean(domain.trim())} />
      <SectionHeader icon={<Globe2 className="size-4" />} title={t('settings.domain.title')} />
      <ol className="mb-4 list-decimal space-y-1 ps-5 text-[13.5px] text-muted-foreground leading-relaxed">
        {(['settings.domain.guide.step1', 'settings.domain.guide.step2', 'settings.domain.guide.step3'] as const).map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>

      <form
        className="flex flex-wrap gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!domain.trim()) {
            return;
          }
          add.mutate(
            { domain: domain.trim() },
            {
              onSuccess: () => {
                toast.success(t('settings.domain.toast.added'));
                setDomain('');
              },
              onError: (_err) => toast.error(t('settings.domain.toast.addError')),
            },
          );
        }}
      >
        <Label className="sr-only" htmlFor="custom-domain">
          {t('settings.domain.title')}
        </Label>
        <Input
          className={cn(FIELD_MONO, 'min-w-0 flex-1')}
          dir="ltr"
          id="custom-domain"
          onChange={(e) => setDomain(e.target.value)}
          placeholder="docs.yoursite.com"
          value={domain}
        />
        <Button className="cursor-pointer rounded-[10px]" disabled={!domain.trim()} loading={add.isPending} type="submit">
          {t('settings.domain.add')}
        </Button>
      </form>

      <div className="mt-4 space-y-3">
        {list.map((d) => (
          <Collapsible
            className="group rounded-xl border border-border p-3.5"
            defaultOpen={d.dnsStatus !== 'VERIFIED' || d.sslStatus !== 'ACTIVE'}
            key={d.id}
          >
            <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <a
                    className="inline-flex items-center gap-1.5 break-all font-medium font-mono text-sm hover:text-primary"
                    dir="ltr"
                    href={`https://${d.domain}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {d.domain} <ExternalLink className="size-3" />
                  </a>
                  {d.dnsStatus === 'VERIFIED' && d.sslStatus === 'ACTIVE' ? (
                    <StatusBadge label={t('settings.domain.status.verified')} tone="ready" />
                  ) : (
                    <StatusBadge
                      label={
                        d.dnsStatus === 'ERROR' || d.sslStatus === 'ERROR'
                          ? t('settings.domain.status.needsAttention')
                          : verify.isPending && verify.variables === d.id
                            ? t('common.loading')
                            : t('settings.domain.status.provisioning')
                      }
                      tone={d.dnsStatus === 'ERROR' || d.sslStatus === 'ERROR' ? 'error' : 'pending'}
                    />
                  )}
                  {d.isPrimary ? (
                    <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 font-semibold text-[12px] text-muted-foreground">
                      {t('settings.domain.status.primary')}
                    </span>
                  ) : null}
                </div>
                {d.lastCheckedAt ? (
                  <p className="mt-1.5 text-muted-foreground text-xs">
                    {t('settings.domain.lastChecked', { date: new Date(d.lastCheckedAt).toLocaleString(localeTag(getLocale())) })}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {d.dnsStatus !== 'VERIFIED' || d.sslStatus !== 'ACTIVE' ? (
                  <CollapsibleTrigger render={<Button className="text-muted-foreground text-xs" size="sm" variant="ghost" />}>
                    {t('settings.domain.configuration')}
                    <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
                  </CollapsibleTrigger>
                ) : null}
                {d.dnsStatus !== 'VERIFIED' || d.sslStatus !== 'ACTIVE' ? (
                  <Button
                    className="cursor-pointer"
                    loading={verify.isPending && verify.variables === d.id}
                    loadingText={t('common.loading')}
                    onClick={() =>
                      verify.mutate(d.id, {
                        onSuccess: (result) =>
                          toast.success(result.sslStatus === 'ACTIVE' ? t('settings.domain.toast.live') : t('settings.domain.status.provisioning')),
                        onError: (_error) => toast.error(t('settings.domain.toast.verifyError')),
                      })
                    }
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw className="size-3.5" />
                    {t('settings.domain.retry')}
                  </Button>
                ) : null}
                {d.dnsStatus === 'VERIFIED' && d.sslStatus === 'ACTIVE' && !d.isPrimary ? (
                  <Button
                    className="cursor-pointer"
                    loading={setPrimary.isPending && setPrimary.variables === d.id}
                    onClick={() => setPrimary.mutate(d.id, { onSuccess: () => toast.success(t('settings.domain.toast.primary')) })}
                    size="sm"
                    variant="outline"
                  >
                    {t('settings.domain.makePrimary')}
                  </Button>
                ) : null}
                <Button
                  className="cursor-pointer"
                  loading={remove.isPending && remove.variables === d.id}
                  onClick={() => removeDomain(d.id, d.domain)}
                  size="sm"
                  variant="ghost"
                >
                  {t('settings.domain.remove')}
                </Button>
              </div>
            </div>

            <CollapsibleContent>
              {d.lastError ? (
                <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-destructive text-sm" dir="ltr">
                  {d.lastError}
                </div>
              ) : null}

              {d.records?.length ? (
                <div className="mt-4">
                  <div className="mb-2.5 font-semibold text-[12px] text-muted-foreground uppercase tracking-wide">
                    {t('settings.domain.dns.heading')}
                  </div>
                  <div className="space-y-3">
                    {d.records.map((record) => {
                      const key = `${record.type}:${record.name}:${record.value}`;
                      const zone = getDomain(d.domain);
                      const fullName = record.name.replace(/\.$/, '');
                      const host = zone && fullName.endsWith(`.${zone}`) ? fullName.slice(0, -(zone.length + 1)) : fullName === zone ? '@' : fullName;
                      return (
                        <div className="rounded-lg border border-border p-3" key={key}>
                          {[
                            { label: t('settings.domain.dns.type'), value: record.type },
                            { label: t('settings.domain.dns.name'), value: host },
                            { label: t('settings.domain.dns.value'), value: record.value },
                          ].map(({ label, value }) => {
                            const fieldKey = `${key}:${label}`;
                            return (
                              <div className="flex items-start gap-2 py-1" key={label}>
                                <div className="min-w-0 flex-1">
                                  <div className="text-muted-foreground text-xs">{label}</div>
                                  <code className="block select-all break-all text-sm" dir="ltr">
                                    {value}
                                  </code>
                                </div>
                                <Button
                                  aria-label={`${t('settings.domain.dns.copy')}: ${label}`}
                                  loading={copyingRecord === fieldKey}
                                  onClick={() => void copyRecord(fieldKey, value)}
                                  size="icon-sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  {copiedRecord === fieldKey ? <Check /> : <Copy />}
                                </Button>
                              </div>
                            );
                          })}
                          <code className="mt-2 block select-all break-all text-muted-foreground text-xs" dir="ltr">
                            {fullName}
                          </code>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-[13px] text-muted-foreground">
                    {d.dnsStatus === 'VERIFIED' ? t('settings.domain.dns.configured') : t('settings.domain.status.provisioning')}
                  </p>
                </div>
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        ))}
        {list.length === 0 ? <p className="text-muted-foreground text-sm">{t('settings.domain.empty')}</p> : null}
      </div>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: 'ready' | 'pending' | 'error' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-[12px]',
        tone === 'ready' && 'bg-primary/10 text-primary',
        tone === 'pending' && 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
        tone === 'error' && 'bg-destructive/10 text-destructive',
      )}
    >
      <span className={cn('size-1.5 rounded-full', tone === 'ready' ? 'bg-primary' : tone === 'pending' ? 'bg-amber-500' : 'bg-destructive')} />
      {label}
    </span>
  );
}
