import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useLocale } from '@nibleaf/i18n/react';
import { Bot, ExternalLink, KeyRound } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { QueryErrorState } from '@/components/query-error-state';
import { FeatureUnavailable } from '@/components/ui/feature-unavailable';
import { useApiKeys } from '@/hooks/api';
import { docsUrl } from '@/lib/docs-url';
import { useConnectedAppsWatch } from '../api/hooks';
import { type AssistantClient, defaultClient, keyClientFor } from '../model/clients';
import { type ConnectWatch, restartWatch, startWatch, watchState, withBaseline } from '../model/connect-watch';
import { type AssistantPolicy, assistantPageState } from '../model/page-state';
import { ConnectCard } from './connect-card';
import { ConnectionsList } from './connections-list';
import { type IssuedKey, KeyDialog } from './key-dialog';
import { TryAsking } from './try-asking';

/** No website limit exists yet (operations/ux/mcp.md D3); the model already takes one. */
const NO_POLICY: AssistantPolicy = {};

/**
 * Settings → AI assistants. Three jobs, top to bottom: connect an app (sign-in
 * first, a personal key when sign-in isn't possible), know what to ask it, and
 * see or remove everything that can use this website.
 */
export function AiAssistantsPage({ projectId, role = '', siteName }: { projectId: string; role?: string; siteName: string }) {
  const { locale, t } = useLocale();
  const keysQuery = useApiKeys(projectId);
  const [watch, setWatch] = useState<ConnectWatch | null>(null);
  const appsQuery = useConnectedAppsWatch(projectId, watch);
  const state = assistantPageState({ meta: keysQuery.data?.meta, role, loadFailed: keysQuery.isError, policy: NO_POLICY });
  const signIn = state.kind === 'ready' && state.signIn;
  const [chosen, setChosen] = useState<AssistantClient | null>(null);
  const client = chosen ?? defaultClient(signIn);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  // Copied while the app list was still loading: take the "before" snapshot once it arrives.
  useEffect(() => {
    if (watch && !watch.baseline && appsQuery.data) setWatch(withBaseline(watch, appsQuery.data));
  }, [watch, appsQuery.data]);
  // "Now" is state, moved forward at the deadline, so "allowed but not working" and
  // "not connected" show without a poll. It must be state: the React Compiler
  // memoizes renders on their inputs, and a bare Date.now() in render isn't one.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!watch) return;
    setNow(Date.now());
    const remaining = watch.until - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining + 50);
    return () => clearTimeout(timer);
  }, [watch]);

  const howItWorks = (
    <a
      className="inline-flex shrink-0 items-center gap-1 text-primary text-sm underline-offset-4 hover:underline"
      href={docsUrl(locale, 'product/ai-assistants')}
      rel="noreferrer"
      target="_blank"
    >
      {t('settings.aiAssistants.howItWorks')}
      <ExternalLink aria-hidden className="size-3.5" />
    </a>
  );
  const retry = () => {
    void keysQuery.refetch();
    void appsQuery.refetch();
  };
  const personalKeyButton = (
    <Button
      onClick={() => {
        setIssued(null);
        setDialogOpen(true);
      }}
      type="button"
      variant="outline"
    >
      <KeyRound aria-hidden />
      {t('settings.aiAssistants.useKey')}
    </Button>
  );
  // With connections off, nothing new can connect: the list stays only so what exists can still be removed.
  const connections = (enabled: boolean, manageAll: boolean) => (
    <SettingsSection
      actions={enabled ? personalKeyButton : undefined}
      description={manageAll ? t('settings.aiAssistants.connectionsDescription') : t('settings.aiAssistants.connectionsDescriptionMember')}
      title={t('settings.aiAssistants.connectionsTitle')}
    >
      <ConnectionsList
        apps={appsQuery}
        enabled={enabled}
        keys={{ ...keysQuery, data: keysQuery.data?.data }}
        manageAll={manageAll}
        onRotated={(key) => {
          setIssued(key);
          setDialogOpen(true);
        }}
        projectId={projectId}
        role={role}
      />
    </SettingsSection>
  );
  const page = (body: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-8">
      <PageHeader actions={howItWorks} description={t('settings.aiAssistants.description')} title={t('settings.aiAssistants.title')} />
      {body}
    </div>
  );

  if (state.kind === 'loading')
    return page(
      <div aria-busy="true" className="flex min-w-0 flex-col gap-8">
        <p className="sr-only" role="status">
          {t('settings.aiAssistants.loading')}
        </p>
        <div aria-hidden className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-9 w-80 max-w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div aria-hidden className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>,
    );

  if (state.kind === 'loadFailed')
    return page(<QueryErrorState description={t('settings.aiAssistants.connectionsLoadError')} onRetry={retry} retrying={keysQuery.isFetching} />);

  if (state.kind === 'noAccess') return page(<Callout tone="neutral">{t('settings.aiAssistants.noAccess')}</Callout>);

  if (state.kind === 'off') {
    // What exists can still be removed; with nothing stored there is nothing to list.
    const nothingStored = keysQuery.data?.data.length === 0 && appsQuery.data?.length === 0;
    return page(
      <>
        <FeatureUnavailable
          description={t('settings.aiAssistants.off.description')}
          icon={<Bot />}
          reason="notConfigured"
          title={t('settings.aiAssistants.off.title')}
        />
        {nothingStored ? null : connections(false, state.manageAll)}
      </>,
    );
  }

  const apps = appsQuery.data ?? [];
  const watchStatus = watch ? watchState(watch, apps, now) : null;
  return page(
    <>
      <SettingsSection title={t('settings.aiAssistants.connectTitle')}>
        <SettingsSectionBody>
          <ConnectCard
            client={client}
            endpoint={state.endpoint}
            onClientChange={(next) => {
              setChosen(next);
              setWatch(null);
            }}
            onCreateKey={() => {
              setIssued(null);
              setDialogOpen(true);
            }}
            onRestart={() => watch && setWatch(restartWatch(watch, Date.now()))}
            // Copying again for the same app keeps its "before" snapshot, so a grant made in between still counts.
            onStarted={() =>
              setWatch((current) =>
                current?.client === client && current.baseline ? restartWatch(current, Date.now()) : startWatch(client, appsQuery.data, Date.now()),
              )
            }
            signIn={state.signIn}
            siteName={siteName}
            watch={watchStatus}
          />
          <p className="mt-4 text-muted-foreground text-sm">{t('settings.aiAssistants.oneSite')}</p>
        </SettingsSectionBody>
      </SettingsSection>
      <SettingsSection description={t('settings.aiAssistants.tryDescription')} title={t('settings.aiAssistants.tryTitle')}>
        <SettingsSectionBody>
          <TryAsking />
        </SettingsSectionBody>
      </SettingsSection>
      {connections(true, state.manageAll)}
      <KeyDialog
        endpoint={state.endpoint}
        initialClient={keyClientFor(client)}
        issued={issued}
        onClose={() => {
          setDialogOpen(false);
          setIssued(null);
        }}
        onIssued={setIssued}
        open={dialogOpen}
        presets={state.presets}
        projectId={projectId}
        role={role}
      />
    </>,
  );
}
