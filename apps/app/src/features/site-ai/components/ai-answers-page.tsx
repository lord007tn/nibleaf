import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList, DataListItem } from '@nibleaf/design-system/components/ui/data-list';
import { Meter } from '@nibleaf/design-system/components/ui/meter';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { RadioField, RadioGroup } from '@nibleaf/design-system/components/ui/radio-group';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useLocale } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { Bot, Circle, CircleCheck, CircleX, ExternalLink, LoaderCircle, ShieldCheck, TriangleAlert } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { QueryErrorState } from '@/components/query-error-state';
import { FeatureUnavailable } from '@/components/ui/feature-unavailable';
import type { Project } from '@/hooks/api';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import type { SiteAdminState } from '@/lib/project-settings-access';
import { usePrepareDocsForAi, useSelectAiSource, useSiteAi } from '../api/hooks';
import {
  type AiKeyProvider,
  type AiPageState,
  type AiSource,
  aiPageState,
  type ChecklistFix,
  type ChecklistRow,
  checklist,
  checklistSource,
  offeredSources,
  preparesOnTurnOn,
  type SiteAi,
  type SourceOption,
  sourceChoiceRequest,
  sourceOptions,
  switchDecision,
  switchRequest,
} from '../model/ai';
import { FIX, PROBLEM, PROVIDER_NAME, REASON, SOURCE_HINT, SOURCE_NAME, STATE, STATE_TONE } from '../model/copy';
import { ProviderKeyForm } from './provider-key-form';

/**
 * Site settings → AI answers (operations/ux/ai-and-integrations.md §4.3, §5.1):
 * is AI on for my docs, what powers it, what it costs, and is it working. It
 * renders what `model/ai.ts` decides from the server's capabilities and status.
 */
export function AiAnswersPage({ project }: { project: Project }) {
  const { t } = useLocale();
  const query = useSiteAi(project.id);
  const { status: access } = useProjectAdminStatus(project.id);

  let body: ReactNode;
  if (query.isPending) body = <AiAnswersSkeleton />;
  else if (!query.data) body = <QueryErrorState onRetry={() => void query.refetch()} retrying={query.isFetching} />;
  else body = <AiAnswersBody access={access} ai={query.data} projectId={project.id} />;

  return (
    <div className="me-auto flex w-full max-w-[47.5rem] flex-col gap-8">
      <PageHeader description={t('settings.ai.description')} title={t('settings.ai')} />
      {access === 'notAdmin' ? <Callout title={t('settings.permissions.title')}>{t('settings.permissions.body')}</Callout> : null}
      {body}
    </div>
  );
}

function AiAnswersBody({ ai, projectId, access }: { ai: SiteAi; projectId: string; access: SiteAdminState }) {
  const { t } = useLocale();
  const state = aiPageState(ai);
  const select = useSelectAiSource(projectId);
  const prepare = usePrepareDocsForAi(projectId);
  // The key form open for a provider (to add, replace or check its key), if any.
  const [openKey, setOpenKey] = useState<AiKeyProvider | null>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);

  if (state.kind === 'unavailable') {
    return (
      <FeatureUnavailable
        description={t('settings.ai.unavailable.description')}
        icon={<Bot />}
        reason="notConfigured"
        title={t('settings.ai.reason.serverUnavailable')}
      />
    );
  }

  const showSources = () => sourcesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const startPreparing = () => prepare.mutate(undefined, { onSuccess: () => toast.success(t('settings.ai.toast.preparing')) });
  const onFix = (fix: ChecklistFix) => {
    if (fix === 'prepare') return startPreparing();
    if (fix === 'chooseSource') return showSources();
    // Key fixes open the selected provider's key form, or the first one offered when nothing is chosen yet.
    const selected = checklistSource(ai);
    const provider = selected && selected !== 'managed' ? selected : selected ? null : offeredSources(ai).find((id) => id !== 'managed');
    if (provider) {
      setOpenKey(provider);
      showSources();
    }
  };

  return (
    <>
      {state.kind === 'notWorking' ? <NotWorkingCallout ai={ai} onFix={onFix} problem={state.problem} projectId={projectId} /> : null}
      <SwitchSection
        access={access}
        ai={ai}
        onChange={(on) => {
          const request = switchRequest(ai, on, access);
          if (!request) return;
          select.mutate(request, {
            onSuccess: () => {
              toast.success(t(on ? 'settings.ai.toast.on' : 'settings.ai.toast.off'));
              // D10: turning answers on starts preparing the docs at once.
              if (on && preparesOnTurnOn(ai)) startPreparing();
            },
          });
        }}
        pending={select.isPending}
        state={state}
      />
      <div ref={sourcesRef}>
        <SourcesSection
          access={access}
          ai={ai}
          onChoose={(source) =>
            select.mutate(sourceChoiceRequest(ai, source), {
              onSuccess: () => toast.success(t('settings.ai.toast.source', { source: t(SOURCE_NAME[source]) })),
            })
          }
          openKey={openKey}
          pending={select.isPending}
          projectId={projectId}
          setOpenKey={setOpenKey}
        />
      </div>
      <ChecklistSection ai={ai} onFix={onFix} preparing={prepare.isPending} projectId={projectId} />
      <p className="flex items-start gap-2 text-muted-foreground text-xs">
        <ShieldCheck aria-hidden className="size-4 shrink-0" />
        {t('settings.ai.security')}
      </p>
    </>
  );
}

/** Words for a problem, with the provider and limit it may name. */
function useProblemText(ai: SiteAi) {
  const { t } = useLocale();
  const provider = ai.status.source && ai.status.source !== 'managed' ? PROVIDER_NAME[ai.status.source] : '';
  return (problem: keyof typeof PROBLEM) => t(PROBLEM[problem], { provider, limit: ai.status.usage.limit });
}

function NotWorkingCallout({
  ai,
  problem,
  projectId,
  onFix,
}: {
  ai: SiteAi;
  problem: keyof typeof PROBLEM;
  projectId: string;
  onFix: (fix: ChecklistFix) => void;
}) {
  const { t } = useLocale();
  const text = useProblemText(ai);
  // The checklist row that carries this problem's fix.
  const fix = checklist(ai).find((row) => row.tone === 'problem')?.fix ?? null;
  return (
    <Callout
      action={fix ? <FixAction fix={fix} onFix={onFix} projectId={projectId} /> : undefined}
      title={t('settings.ai.notWorking.title')}
      tone="danger"
    >
      {text(problem)}
    </Callout>
  );
}

function SwitchSection({
  ai,
  state,
  access,
  pending,
  onChange,
}: {
  ai: SiteAi;
  state: Exclude<AiPageState, { kind: 'unavailable' }>;
  access: SiteAdminState;
  pending: boolean;
  onChange: (on: boolean) => void;
}) {
  const { t } = useLocale();
  const { decision } = switchDecision(ai, access);
  const copy = STATE[state.kind];
  const reason = decision.kind === 'denied' ? t(REASON[decision.reason]) : undefined;
  return (
    <SettingsSection>
      <SettingsRow
        control="switch"
        description={t(copy.line)}
        disabledReason={reason}
        label={
          <span className="inline-flex flex-wrap items-center gap-2">
            {t('settings.ai.switch.label')}
            <StatusBadge tone={STATE_TONE[state.kind]}>{t(copy.badge)}</StatusBadge>
          </span>
        }
      >
        {(ids) => (
          <Switch
            {...ids.controlProps}
            aria-labelledby={ids.labelId}
            checked={ai.status.answersOn}
            disabled={pending || decision.kind !== 'allowed'}
            onCheckedChange={onChange}
          />
        )}
      </SettingsRow>
    </SettingsSection>
  );
}

function SourcesSection({
  ai,
  access,
  projectId,
  pending,
  openKey,
  setOpenKey,
  onChoose,
}: {
  ai: SiteAi;
  access: SiteAdminState;
  projectId: string;
  pending: boolean;
  openKey: AiKeyProvider | null;
  setOpenKey: (provider: AiKeyProvider | null) => void;
  onChoose: (source: AiSource) => void;
}) {
  const { t } = useLocale();
  const options = sourceOptions(ai, access);
  const selected = options.find((option) => option.selected)?.id ?? '';
  return (
    <SettingsSection description={t('settings.ai.sources.description')} title={t('settings.ai.sources.title')}>
      <RadioGroup
        aria-label={t('settings.ai.sources.title')}
        className="flex flex-col gap-3"
        disabled={pending || access !== 'admin'}
        onValueChange={(value) => onChoose(value as AiSource)}
        value={selected}
      >
        {options.map((option) => (
          <SourceCard
            ai={ai}
            canManage={access === 'admin'}
            key={option.id}
            keyOpen={openKey === option.id}
            option={option}
            projectId={projectId}
            setKeyOpen={(open) => setOpenKey(open && option.id !== 'managed' ? option.id : null)}
          />
        ))}
      </RadioGroup>
    </SettingsSection>
  );
}

function SourceCard({
  ai,
  option,
  projectId,
  canManage,
  keyOpen,
  setKeyOpen,
}: {
  ai: SiteAi;
  option: SourceOption;
  projectId: string;
  canManage: boolean;
  keyOpen: boolean;
  setKeyOpen: (open: boolean) => void;
}) {
  const { t } = useLocale();
  const { date } = useDateFormat();
  const connection = option.connection;
  // On a card, "add a key first" is the card's own key: name it, next to the card's Add key button.
  const reason =
    option.decision.kind !== 'denied'
      ? undefined
      : option.decision.reason === 'addKeyFirst' && option.id !== 'managed'
        ? t('settings.ai.problem.keyMissing', { provider: PROVIDER_NAME[option.id] })
        : t(REASON[option.decision.reason]);
  const managed = ai.capabilities.managed;
  return (
    <div className={`rounded-lg border p-4 ${option.selected ? 'border-foreground/60' : ''}`} data-source={option.id}>
      <RadioField description={t(SOURCE_HINT[option.id])} disabledReason={reason} label={t(SOURCE_NAME[option.id])} value={option.id} />
      <div className="mt-3 flex flex-wrap items-center gap-2 ps-7 text-sm">
        {option.id === 'managed' ? (
          <>
            {managed.model ? <StatusBadge>{t('settings.ai.model', { model: managed.model.label })}</StatusBadge> : null}
            <StatusBadge>{t('settings.ai.dailyLimit', { limit: managed.dailyAnswerLimit })}</StatusBadge>
          </>
        ) : (
          <>
            {connection?.state === 'ok' ? <StatusBadge tone="success">{t('settings.ai.key.works')}</StatusBadge> : null}
            {connection?.keyHint ? (
              // The hint stays left-to-right inside any sentence (U+2066…U+2069 isolate it).
              <StatusBadge>{t('settings.ai.key.hint', { hint: `⁦…${connection.keyHint}⁩` })}</StatusBadge>
            ) : null}
            {connection?.addedAt ? <StatusBadge>{t('settings.ai.key.added', { date: date(connection.addedAt) })}</StatusBadge> : null}
            {connection?.model ? <StatusBadge>{t('settings.ai.model', { model: connection.model.label })}</StatusBadge> : null}
            {canManage ? (
              <Button onClick={() => setKeyOpen(!keyOpen)} size="sm" type="button" variant="outline">
                {t(keyOpen ? 'settings.ai.key.done' : connection ? 'settings.ai.key.manage' : 'settings.ai.key.add')}
              </Button>
            ) : null}
          </>
        )}
      </div>
      {option.id !== 'managed' && option.selected ? (
        <p className="mt-3 ps-7 text-muted-foreground text-xs">
          {t('settings.ai.whoPays', { provider: PROVIDER_NAME[option.id], limit: ai.status.usage.limit })}
        </p>
      ) : null}
      {option.id !== 'managed' && keyOpen && canManage ? (
        <div className="mt-3 ps-7">
          <ProviderKeyForm onSaved={() => setKeyOpen(false)} projectId={projectId} providerId={option.id} />
        </div>
      ) : null}
    </div>
  );
}

function ChecklistSection({
  ai,
  projectId,
  preparing,
  onFix,
}: {
  ai: SiteAi;
  projectId: string;
  preparing: boolean;
  onFix: (fix: ChecklistFix) => void;
}) {
  const { t } = useLocale();
  const rows = checklist(ai);
  return (
    <SettingsSection description={t('settings.ai.check.description')} title={t('settings.ai.check.title')}>
      <DataList>
        {rows.map((row) => (
          <ChecklistItem ai={ai} key={row.id} onFix={onFix} preparing={preparing} projectId={projectId} row={row} />
        ))}
      </DataList>
      {ai.status.published ? (
        <Button
          className="mt-3 w-fit"
          nativeButton={false}
          render={<Link params={{ projectId }} target="_blank" to="/sites/$projectId" />}
          size="sm"
          variant="outline"
        >
          {t('settings.ai.tryIt')}
          <ExternalLink aria-hidden />
        </Button>
      ) : null}
    </SettingsSection>
  );
}

function ChecklistItem({
  ai,
  row,
  projectId,
  preparing,
  onFix,
}: {
  ai: SiteAi;
  row: ChecklistRow;
  projectId: string;
  preparing: boolean;
  onFix: (fix: ChecklistFix) => void;
}) {
  const { t } = useLocale();
  const { number } = useDateFormat();
  const text = useProblemText(ai);
  const { status } = ai;
  const state = aiPageState(ai);
  const { title, detail } = ((): { title: string; detail?: ReactNode } => {
    if (row.id === 'published') {
      return status.published
        ? { title: t('settings.ai.check.published'), detail: t('settings.ai.check.publishedDetail', { version: number(status.published.version) }) }
        : { title: t('settings.ai.check.notPublished'), detail: t('settings.ai.reason.publishFirst') };
    }
    if (row.id === 'prepared') {
      const pages = number(status.preparation.pages);
      const expected = number(status.preparation.expectedPages);
      if (!status.published) return { title: t('settings.ai.check.notPrepared'), detail: t('settings.ai.check.waitsForPublish') };
      switch (status.preparation.state) {
        case 'ready':
          return { title: t('settings.ai.check.prepared'), detail: t('settings.ai.check.preparedDetail', { pages }) };
        case 'running':
          // The page count arrives once the run has listed the pages; until then there's nothing to count.
          return {
            title: t('settings.ai.check.preparing'),
            detail: status.preparation.expectedPages > 0 ? t('settings.ai.check.preparingDetail', { pages, expected }) : undefined,
          };
        case 'partial':
          return { title: t('settings.ai.check.partial'), detail: t('settings.ai.check.partialDetail', { pages, expected }) };
        case 'failed':
          return { title: t('settings.ai.check.failed'), detail: t('settings.ai.check.failedDetail') };
        default:
          return { title: t('settings.ai.check.notPrepared') };
      }
    }
    if (row.id === 'source') {
      const source = checklistSource(ai);
      if (source === null) return { title: t('settings.ai.check.source.none') };
      if (row.tone === 'problem' && state.kind === 'notWorking') return { title: t('settings.ai.check.source.problem'), detail: text(state.problem) };
      const title =
        source === 'managed' ? t('settings.ai.check.source.managed') : t('settings.ai.check.source.key', { provider: PROVIDER_NAME[source] });
      return { title, detail: row.tone === 'idle' ? t('settings.ai.check.source.idle') : undefined };
    }
    // Today's answers.
    const { usage } = status;
    if (row.tone === 'problem') return { title: t('settings.ai.usage.title'), detail: text('limitReached') };
    return {
      title: t('settings.ai.usage.title'),
      detail:
        usage.spent === null ? (
          t('settings.ai.usage.unknown')
        ) : (
          <span className="flex flex-col gap-1.5">
            <Meter
              className="w-40"
              label={t('settings.ai.usage.title')}
              value={usage.limit > 0 ? Math.min(100, (usage.spent / usage.limit) * 100) : 100}
              valueText={t('settings.ai.usage.meter', { used: number(usage.spent), limit: number(usage.limit) })}
            />
            <span>
              {t('settings.ai.usage.meter', { used: number(usage.spent), limit: number(usage.limit) })}
              {usage.answersToday === null ? null : ` · ${t('settings.ai.usage.answered', { answered: number(usage.answersToday) })}`}
              {` · ${t('settings.ai.usage.resets')}`}
            </span>
          </span>
        ),
    };
  })();
  return (
    <DataListItem
      data-check={row.id}
      data-tone={row.tone}
      description={detail}
      leading={<CheckIcon tone={row.tone} />}
      title={title}
      trailing={row.fix ? <FixAction fix={row.fix} onFix={onFix} pending={row.fix === 'prepare' && preparing} projectId={projectId} /> : undefined}
    />
  );
}

/** A step's state at a glance; its title says the same in words. */
function CheckIcon({ tone }: { tone: ChecklistRow['tone'] }) {
  const Icon = { ok: CircleCheck, working: LoaderCircle, warning: TriangleAlert, problem: CircleX, idle: Circle }[tone];
  return <Icon aria-hidden className={`size-5 ${CHECK_ICON_TONE[tone]}`} />;
}

const CHECK_ICON_TONE: Record<ChecklistRow['tone'], string> = {
  ok: 'text-success',
  working: 'animate-spin text-muted-foreground motion-reduce:animate-none',
  warning: 'text-warning',
  problem: 'text-destructive',
  idle: 'text-muted-foreground',
};

/** The one fix for a failing step: a link where the fix lives elsewhere, a button where it happens here. */
function FixAction({
  fix,
  projectId,
  pending = false,
  onFix,
}: {
  fix: ChecklistFix;
  projectId: string;
  pending?: boolean;
  onFix: (fix: ChecklistFix) => void;
}) {
  const { t } = useLocale();
  const id = useId();
  if (fix === 'publish') {
    return (
      <Button nativeButton={false} render={<Link params={{ projectId }} to="/app/projects/$projectId/editor" />} size="sm" variant="outline">
        {t(FIX[fix])}
      </Button>
    );
  }
  if (fix === 'seeUsage') {
    return (
      <Button
        nativeButton={false}
        render={<Link params={{ projectId }} search={{ section: 'usage' }} to="/app/projects/$projectId/settings" />}
        size="sm"
        variant="outline"
      >
        {t(FIX[fix])}
      </Button>
    );
  }
  return (
    <Button id={id} loading={pending} onClick={() => onFix(fix)} size="sm" type="button" variant="outline">
      {t(FIX[fix])}
    </Button>
  );
}

/** The page's shape while it loads: the switch row, three source cards and four checks. */
function AiAnswersSkeleton() {
  const { t } = useLocale();
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      <div aria-hidden className="flex items-center justify-between gap-4 rounded-xl border p-5">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>
        <Skeleton className="h-5.5 w-10 rounded-full" />
      </div>
      <div aria-hidden className="space-y-3" data-skeleton="sources">
        {['managed', 'openai', 'openrouter'].map((id) => (
          <Skeleton className="h-20 w-full rounded-lg" key={id} />
        ))}
      </div>
      <div aria-hidden className="space-y-2" data-skeleton="checks">
        {['published', 'prepared', 'source', 'usage'].map((id) => (
          <Skeleton className="h-10 w-full" key={id} />
        ))}
      </div>
    </div>
  );
}

/** Dates and numbers in the reader's language. */
function useDateFormat() {
  const { locale } = useLocale();
  return {
    date: (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value)),
    number: (value: number) => new Intl.NumberFormat(locale).format(value),
  };
}
