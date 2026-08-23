import { Button } from '@nibleaf/design-system/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@nibleaf/design-system/components/ui/collapsible';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { Check, ChevronDown, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@/hooks/api';
import { useAddDomain, useDeleteDomain, useDomains, useSetPrimaryDomain, useVerifyDomain } from '@/hooks/api';
import { copyToClipboard } from '@/lib/invitations';
import { FIELD_MONO, SectionHeader } from './shared';

export function DomainSection({ project }: { project: Project }) {
  const t = useT();
  const confirm = useConfirm();
  const { data: domains } = useDomains(project.id);
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
  const [copiedRecord, setCopiedRecord] = useState<string | null>(null);

  const list = domains ?? [];
  const copyRecord = async (key: string, text: string) => {
    const ok = await copyToClipboard(text);
    if (!ok) {
      toast.error(t('settings.domain.dns.copyFailed'));
      return;
    }
    setCopiedRecord(key);
    toast.success(t('settings.domain.dns.copied'));
    window.setTimeout(() => setCopiedRecord((current) => (current === key ? null : current)), 1600);
  };

  return (
    <div>
      <SectionHeader icon="◷" title={t('settings.domain.title')} />
      <p className="mb-4 text-[13.5px] text-muted-foreground leading-relaxed">{t('settings.domain.description')}</p>

      <form
        className="flex gap-2.5"
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
              onError: (err) => toast.error(err instanceof Error ? err.message : t('settings.domain.toast.addError')),
            },
          );
        }}
      >
        <Input className={cn(FIELD_MONO, 'flex-1')} onChange={(e) => setDomain(e.target.value)} placeholder="docs.yoursite.com" value={domain} />
        <Button className="cursor-pointer rounded-[10px]" disabled={add.isPending} type="submit">
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
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <a
                    className="inline-flex items-center gap-1.5 truncate font-medium font-mono text-sm hover:text-primary"
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
                    {t('settings.domain.lastChecked', { date: new Date(d.lastCheckedAt).toLocaleString() })}
                  </p>
                ) : null}
              </div>
              <div className="flex gap-1.5">
                {d.dnsStatus !== 'VERIFIED' || d.sslStatus !== 'ACTIVE' ? (
                  <CollapsibleTrigger className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 font-medium text-muted-foreground text-xs hover:bg-muted hover:text-foreground">
                    {t('settings.domain.configuration')}
                    <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
                  </CollapsibleTrigger>
                ) : null}
                {d.dnsStatus !== 'VERIFIED' || d.sslStatus !== 'ACTIVE' ? (
                  <Button
                    className="cursor-pointer"
                    disabled={verify.isPending}
                    onClick={() =>
                      verify.mutate(d.id, {
                        onSuccess: (result) =>
                          toast.success(result.sslStatus === 'ACTIVE' ? t('settings.domain.toast.live') : t('settings.domain.toast.provisioning')),
                        onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.domain.toast.verifyError')),
                      })
                    }
                    size="sm"
                    variant="outline"
                  >
                    <RefreshCw className={cn('size-3.5', verify.isPending && 'animate-spin')} />
                    {d.lastCheckedAt ? t('settings.domain.retry') : t('settings.domain.verifyDns')}
                  </Button>
                ) : null}
                {d.dnsStatus === 'VERIFIED' && d.sslStatus === 'ACTIVE' && !d.isPrimary ? (
                  <Button
                    className="cursor-pointer"
                    onClick={() => setPrimary.mutate(d.id, { onSuccess: () => toast.success(t('settings.domain.toast.primary')) })}
                    size="sm"
                    variant="outline"
                  >
                    {t('settings.domain.makePrimary')}
                  </Button>
                ) : null}
                <Button className="cursor-pointer" onClick={() => removeDomain(d.id, d.domain)} size="sm" variant="ghost">
                  {t('settings.domain.remove')}
                </Button>
              </div>
            </div>

            <CollapsibleContent>
              {d.lastError ? (
                <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-destructive text-sm">{d.lastError}</div>
              ) : null}

              {d.records?.length ? (
                <div className="mt-4">
                  <div className="mb-2.5 font-semibold text-[12px] text-muted-foreground uppercase tracking-wide">
                    {t('settings.domain.dns.heading')}
                  </div>
                  <div className="overflow-hidden rounded-xl border border-border font-mono text-[12.5px]">
                    <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1.35fr)_36px] border-border border-b bg-muted/40 px-3.5 py-2.5 text-muted-foreground">
                      <span>{t('settings.domain.dns.type')}</span>
                      <span>{t('settings.domain.dns.name')}</span>
                      <span>{t('settings.domain.dns.value')}</span>
                      <span className="sr-only">{t('settings.domain.dns.copy')}</span>
                    </div>
                    {d.records.map((record) => {
                      const key = `${record.type}:${record.name}:${record.value}`;
                      return (
                        <div className="grid grid-cols-[72px_minmax(0,1fr)_minmax(0,1.35fr)_36px] items-center gap-2 px-3.5 py-2.5" key={key}>
                          <span className="font-semibold">{record.type}</span>
                          <span className="truncate" title={record.name}>
                            {record.name}
                          </span>
                          <span className="truncate text-primary" title={record.value}>
                            {record.value}
                          </span>
                          <Button
                            aria-label={t('settings.domain.dns.copy')}
                            className="size-8 cursor-pointer p-0"
                            onClick={() => void copyRecord(key, `${record.type} ${record.name} ${record.value}`)}
                            size="sm"
                            title={t('settings.domain.dns.copy')}
                            type="button"
                            variant="ghost"
                          >
                            {copiedRecord === key ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-[13px] text-muted-foreground">
                    {d.dnsStatus === 'VERIFIED' ? t('settings.domain.dns.configured') : t('settings.domain.dns.propagation')}
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
