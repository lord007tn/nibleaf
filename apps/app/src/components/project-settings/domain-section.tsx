import { Button } from '@midad/design-system/components/ui/button';
import { Input } from '@midad/design-system/components/ui/input';
import { cn } from '@midad/design-system/lib/utils';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@/hooks/api';
import { useAddDomain, useDeleteDomain, useDomains, useSetPrimaryDomain, useVerifyDomain } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { copyToClipboard } from '@/lib/invitations';
import { FIELD_MONO, SectionHeader } from './shared';

export function DomainSection({ project }: { project: Project }) {
  const t = useT();
  const { data: domains } = useDomains(project.id);
  const add = useAddDomain(project.id);
  const verify = useVerifyDomain(project.id);
  const setPrimary = useSetPrimaryDomain(project.id);
  const remove = useDeleteDomain(project.id);
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
          <div className="rounded-xl border border-border p-3.5" key={d.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="font-medium font-mono text-sm">{d.domain}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-[12px]',
                    d.verified ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-600',
                  )}
                >
                  <span className={cn('size-1.5 rounded-full', d.verified ? 'bg-primary' : 'bg-amber-500')} />
                  {d.verified ? t('settings.domain.status.live') : t('settings.domain.status.pending')}
                </span>
                {d.isPrimary ? (
                  <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 font-semibold text-[12px] text-muted-foreground">
                    {t('settings.domain.status.primary')}
                  </span>
                ) : null}
              </div>
              <div className="flex gap-1.5">
                {!d.verified ? (
                  <Button
                    className="cursor-pointer"
                    onClick={() => verify.mutate(d.id, { onSuccess: () => toast.success(t('settings.domain.toast.verified')) })}
                    size="sm"
                    variant="outline"
                  >
                    {t('settings.domain.verifyDns')}
                  </Button>
                ) : null}
                {d.verified && !d.isPrimary ? (
                  <Button
                    className="cursor-pointer"
                    onClick={() => setPrimary.mutate(d.id, { onSuccess: () => toast.success(t('settings.domain.toast.primary')) })}
                    size="sm"
                    variant="outline"
                  >
                    {t('settings.domain.makePrimary')}
                  </Button>
                ) : null}
                <Button className="cursor-pointer" onClick={() => remove.mutate(d.id)} size="sm" variant="ghost">
                  {t('settings.domain.remove')}
                </Button>
              </div>
            </div>

            {!d.verified && d.records?.length ? (
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
                <p className="mt-3 text-[13px] text-muted-foreground">{t('settings.domain.dns.propagation')}</p>
              </div>
            ) : null}
          </div>
        ))}
        {list.length === 0 ? <p className="text-muted-foreground text-sm">{t('settings.domain.empty')}</p> : null}
      </div>
    </div>
  );
}
