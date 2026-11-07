import { Button } from '@nibleaf/design-system/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@nibleaf/design-system/components/ui/collapsible';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { getLocale, type MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { isDomainLive } from '@nibleaf/shared/domains';
import { DOMAIN_NAME_PATTERN, normalizeDomainInput } from '@nibleaf/validators';
import { Check, ChevronDown, Copy, ExternalLink, Globe2, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { getDomain } from 'tldts';
import { QueryErrorState } from '@/components/query-error-state';
import type { DomainStage, Project } from '@/hooks/api';
import {
  demotedByError,
  domainErrorMessage,
  domainStage,
  useAddDomain,
  useDeleteDomain,
  useDomains,
  useSetPrimaryDomain,
  useVerifyDomain,
} from '@/hooks/api';
import { localeTag } from '@/lib/format';
import { copyToClipboard } from '@/lib/invitations';
import { DirtyStateReporter, FIELD_MONO, SectionHeader } from './shared';

const DOMAIN_SKELETON_CARDS = ['first', 'second'];

type Tone = 'ready' | 'pending' | 'error';

/** One badge and one explanation per setup step, so the card never says DNS is pending once it is not. */
const STAGES: Record<DomainStage, { badge: MessageKey; tone: Tone; help?: MessageKey }> = {
  waiting: { badge: 'settings.domain.status.provisioning', tone: 'pending', help: 'settings.domain.state.waiting' },
  dnsProblem: { badge: 'settings.domain.status.dnsError', tone: 'error', help: 'settings.domain.state.dnsProblem' },
  securing: { badge: 'settings.domain.status.sslProvisioning', tone: 'pending', help: 'settings.domain.state.securing' },
  httpsProblem: { badge: 'settings.domain.status.sslError', tone: 'error', help: 'settings.domain.state.httpsProblem' },
  live: { badge: 'settings.domain.status.verified', tone: 'ready' },
};

/** What a finished check means for the owner, worded for the state it found. */
const CHECK_RESULT: Record<DomainStage, { key: MessageKey; kind: 'success' | 'info' | 'error' }> = {
  live: { key: 'settings.domain.toast.live', kind: 'success' },
  securing: { key: 'settings.domain.toast.provisioning', kind: 'info' },
  waiting: { key: 'settings.domain.toast.waiting', kind: 'info' },
  dnsProblem: { key: 'settings.domain.toast.needsAttention', kind: 'error' },
  httpsProblem: { key: 'settings.domain.toast.needsAttention', kind: 'error' },
};

/** Keep a domain name in one reading direction inside Arabic sentences. */
const isolate = (value: string) => `⁨${value}⁩`;

/** A root domain (`example.com`, `example.co.uk`) often can't take a CNAME record. */
const isApexDomain = (domain: string) => getDomain(domain) === domain;

/** The section's first load: heading, the three guide steps, the add row and domain cards, so nothing moves on arrival. */
function DomainSectionSkeleton() {
  const t = useT();
  return (
    <div aria-busy="true">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div aria-hidden>
        <div className="mb-6 border-border border-b pb-3">
          <Skeleton className="h-7 w-40" />
        </div>
        <div className="mb-4 space-y-2 ps-5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Skeleton className="h-10 min-w-0 flex-1" />
          <Skeleton className="h-10 w-28 rounded-[10px]" />
        </div>
        <div className="mt-4 space-y-3">
          {DOMAIN_SKELETON_CARDS.map((card) => (
            <div className="rounded-xl border border-border p-3.5" key={card}>
              <div className="flex items-center gap-2.5">
                <Skeleton className="h-5 w-48 max-w-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

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
      description: t('settings.domain.removeConfirm', { domain: isolate(name) }),
      confirmLabel: t('settings.domain.remove'),
      destructive: true,
    });
    if (ok) {
      // Failures are reported by the hook, in words that match the reason.
      remove.mutate(id, { onSuccess: () => toast.success(t('settings.domain.toast.removed')) });
    }
  };
  // The reason a check failed is toasted by the hook; losing the main address is said here.
  const demotedToast = (name: string) => toast.warning(t('settings.domain.toast.demoted', { domain: isolate(name) }));
  const checkDomain = (id: string, name: string) =>
    verify.mutate(id, {
      onSuccess: (result) => {
        if (result.demoted) return demotedToast(name);
        const { key, kind } = CHECK_RESULT[domainStage(result)];
        toast[kind](t(key));
      },
      onError: (error) => {
        if (demotedByError(error)) demotedToast(name);
      },
    });
  const [domain, setDomain] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [copyingRecord, setCopyingRecord] = useState<string | null>(null);
  const [copiedRecord, setCopiedRecord] = useState<string | null>(null);

  // What was typed or pasted (`https://Docs.Example.com/help`), reduced to what will be connected.
  const cleaned = normalizeDomainInput(domain);
  const cleanedValid = DOMAIN_NAME_PATTERN.test(cleaned);

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
  if (query.isPending) return <DomainSectionSkeleton />;
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
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!cleaned) {
            return;
          }
          if (!cleanedValid) {
            setFormError(t('settings.domain.error.invalid'));
            return;
          }
          setDomain(cleaned);
          add.mutate(
            { domain: cleaned },
            {
              onSuccess: () => {
                toast.success(t('settings.domain.toast.added'));
                setDomain('');
              },
              // Shown under the field, where the fix happens, instead of a generic toast.
              onError: (error) => setFormError(domainErrorMessage(t, error, 'settings.domain.toast.addError')),
            },
          );
        }}
      >
        <Label className="sr-only" htmlFor="custom-domain">
          {t('settings.domain.title')}
        </Label>
        <Input
          aria-describedby={formError ? 'custom-domain-error' : cleanedValid && isApexDomain(cleaned) ? 'custom-domain-apex' : undefined}
          aria-invalid={formError ? true : undefined}
          autoCapitalize="none"
          autoComplete="off"
          className={cn(FIELD_MONO, 'min-w-0 flex-1')}
          dir="ltr"
          id="custom-domain"
          inputMode="url"
          onBlur={() => {
            if (cleanedValid && cleaned !== domain) setDomain(cleaned);
          }}
          onChange={(e) => {
            setDomain(e.target.value);
            setFormError(null);
          }}
          placeholder="docs.yoursite.com"
          spellCheck={false}
          value={domain}
        />
        <Button className="cursor-pointer rounded-[10px]" disabled={!cleaned} loading={add.isPending} type="submit">
          {t('settings.domain.add')}
        </Button>
        {formError ? (
          <p className="w-full text-destructive text-sm" id="custom-domain-error" role="alert">
            {formError}
          </p>
        ) : cleanedValid && isApexDomain(cleaned) ? (
          <p className="w-full text-muted-foreground text-sm" id="custom-domain-apex">
            {t('settings.domain.apexHint', { domain: isolate(cleaned) })}
          </p>
        ) : null}
      </form>

      <div className="mt-4 space-y-3">
        {list.map((d) => {
          const stage = domainStage(d);
          const { badge, tone, help } = STAGES[stage];
          const checking = verify.isPending && verify.variables === d.id;
          const zone = getDomain(d.domain);
          return (
            <Collapsible className="group rounded-xl border border-border p-3.5" defaultOpen={stage !== 'live'} key={d.id}>
              <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    {/* Linking an address that doesn't serve the docs yet would only open a browser error. */}
                    {isDomainLive(d) ? (
                      <a
                        className="inline-flex items-center gap-1.5 break-all font-medium font-mono text-sm hover:text-primary"
                        dir="ltr"
                        href={`https://${d.domain}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {d.domain} <ExternalLink className="size-3" />
                      </a>
                    ) : (
                      <span className="break-all font-medium font-mono text-sm" dir="ltr">
                        {d.domain}
                      </span>
                    )}
                    <StatusBadge label={checking ? t('settings.domain.status.checking') : t(badge)} tone={checking ? 'pending' : tone} />
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
                  {d.isPrimary ? <p className="mt-1 text-muted-foreground text-xs">{t('settings.domain.primaryHint')}</p> : null}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {stage !== 'live' ? (
                    <CollapsibleTrigger render={<Button className="text-muted-foreground text-xs" size="sm" variant="ghost" />}>
                      {t('settings.domain.configuration')}
                      <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
                    </CollapsibleTrigger>
                  ) : null}
                  {/* Also on a live domain: after changing DNS, the owner can confirm it still works. */}
                  <Button
                    className="cursor-pointer"
                    loading={checking}
                    loadingText={t('settings.domain.status.checking')}
                    onClick={() => checkDomain(d.id, d.domain)}
                    size="sm"
                    variant={stage === 'live' ? 'ghost' : 'outline'}
                  >
                    <RefreshCw className="size-3.5" />
                    {t('settings.domain.retry')}
                  </Button>
                  {stage === 'live' && !d.isPrimary ? (
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

              {/* What this step means and what to do next, visible even with the records folded away. */}
              {help ? (
                <p
                  className={cn(
                    'mt-3 rounded-lg border px-3 py-2 text-sm leading-relaxed',
                    tone === 'error' ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-border bg-muted/40 text-muted-foreground',
                  )}
                >
                  {t(help)}
                </p>
              ) : null}

              <CollapsibleContent>
                {stage !== 'live' && isApexDomain(d.domain) ? (
                  <p className="mt-3 text-muted-foreground text-sm">{t('settings.domain.apexHint', { domain: isolate(d.domain) })}</p>
                ) : null}
                {/* The server's own wording is English and technical: kept for support, folded away. */}
                {stage !== 'live' && d.lastError ? (
                  <details className="mt-3 text-muted-foreground text-xs">
                    <summary className="cursor-pointer select-none">{t('settings.domain.technicalDetails')}</summary>
                    <code className="mt-1.5 block break-all" dir="ltr">
                      {d.lastError}
                    </code>
                  </details>
                ) : null}

                {d.records?.length ? (
                  <div className="mt-4">
                    <div className="mb-2.5 font-semibold text-[12px] text-muted-foreground uppercase tracking-wide">
                      {t('settings.domain.dns.heading')}
                    </div>
                    <div className="space-y-3">
                      {d.records.map((record) => {
                        const key = `${record.type}:${record.name}:${record.value}`;
                        const fullName = record.name.replace(/\.$/, '');
                        const host =
                          zone && fullName.endsWith(`.${zone}`) ? fullName.slice(0, -(zone.length + 1)) : fullName === zone ? '@' : fullName;
                        // The CNAME on the address itself routes readers; every other record proves control of the domain.
                        const purpose =
                          record.type === 'CNAME' && fullName === d.domain ? 'settings.domain.dns.purpose.cname' : 'settings.domain.dns.purpose.txt';
                        return (
                          <div className="rounded-lg border border-border p-3" key={key}>
                            <p className="mb-1 text-muted-foreground text-xs">{t(purpose)}</p>
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
                            {host === fullName ? null : (
                              <p className="mt-2 text-muted-foreground text-xs">
                                {t('settings.domain.dns.fullName')}{' '}
                                <code className="select-all break-all" dir="ltr">
                                  {fullName}
                                </code>
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          );
        })}
        {list.length === 0 ? <p className="text-muted-foreground text-sm">{t('settings.domain.empty')}</p> : null}
      </div>
    </div>
  );
}

function StatusBadge({ label, tone }: { label: string; tone: Tone }) {
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
