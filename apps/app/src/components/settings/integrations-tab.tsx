import { Button, buttonVariants } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { StatusBadge, type StatusBadgeTone } from '@nibleaf/design-system/components/ui/status-badge';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { IntegrationCatalogEntry, IntegrationProviderId } from '@nibleaf/shared/integrations';
import { randomUUID } from '@nibleaf/shared/uuid';
import { Link, useNavigate } from '@tanstack/react-router';
import { Activity, ArrowLeft, Bot, ChartNoAxesCombined, GitBranch, MessageSquare, RefreshCw, ShieldCheck, Trash2, Zap } from 'lucide-react';
import { type ComponentType, type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { GithubIcon, SlackIcon } from '@/components/icons/brand';
import { NO_AUTOFILL_PROPS, SecretInput } from '@/components/secret-input';
import { AnalyticsSettings } from '@/features/site-analytics-settings/components/analytics-settings';
import { useWebhookIntegrationSaveCommand } from '@/features/site-integrations/components/use-webhook-integration-save-command';
import {
  type CardLine,
  type CardState,
  detailEntry,
  type HubCard,
  type HubGroupId,
  hubCard,
  hubGroups,
} from '@/features/site-integrations/model/hub';
import type { IntegrationDetailId } from '@/features/site-settings/model/ids';
import {
  type Project,
  useActivateProjectIntegration,
  useDeactivateProjectIntegration,
  useDeleteProjectIntegration,
  useProjectIntegrations,
  useVerifyProjectIntegration,
} from '@/hooks/api';
import { SettingsSection } from './section';

type ConfigurableProviderId = 'slack' | 'discord' | 'zapier';
type ProviderIcon = ComponentType<{ className?: string }>;

/** The providers the hub draws (features/site-integrations/model/hub.ts): their names, one-line benefit and icon. */
const PROVIDER_META: Partial<Record<IntegrationProviderId, { name: MessageKey; description: MessageKey; icon: ProviderIcon; tint: string }>> = {
  github: {
    name: 'settings.integrations.provider.github',
    description: 'settings.integrations.github.description',
    icon: GithubIcon,
    tint: 'bg-foreground/10 text-foreground',
  },
  gitlab: {
    name: 'settings.integrations.provider.gitlab',
    description: 'settings.integrations.gitlab.description',
    icon: GitBranch,
    tint: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  },
  'public-git': {
    name: 'settings.integrations.provider.publicGit',
    description: 'settings.integrations.publicGit.description',
    icon: GitBranch,
    tint: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  },
  'google-analytics': {
    name: 'settings.integrations.provider.googleAnalytics',
    description: 'settings.integrations.googleAnalytics.description',
    icon: ChartNoAxesCombined,
    tint: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  plausible: {
    name: 'settings.integrations.provider.plausible',
    description: 'settings.integrations.plausible.description',
    icon: Activity,
    tint: 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  },
  slack: {
    name: 'settings.integrations.provider.slack',
    description: 'settings.integrations.slack.description',
    icon: SlackIcon,
    tint: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  },
  discord: {
    name: 'settings.integrations.provider.discord',
    description: 'settings.integrations.discord.description',
    icon: MessageSquare,
    tint: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  },
  zapier: {
    name: 'settings.integrations.provider.zapier',
    description: 'settings.integrations.zapier.description',
    icon: Zap,
    tint: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
};
const metaOf = (id: IntegrationProviderId) => {
  const meta = PROVIDER_META[id];
  if (!meta) throw new Error(`No hub card for ${id}`);
  return meta;
};

const GROUP_KEYS: Record<HubGroupId, MessageKey> = {
  sync: 'settings.integrations.group.sync',
  analytics: 'settings.integrations.group.analytics',
  notifications: 'settings.integrations.group.notifications',
  automation: 'settings.integrations.group.automation',
};

const PLACEHOLDER_KEYS = {
  slack: 'settings.integrations.placeholder.slack',
  discord: 'settings.integrations.placeholder.discord',
  zapier: 'settings.integrations.placeholder.zapier',
} as const satisfies Record<ConfigurableProviderId, MessageKey>;

const isConfigurableProvider = (providerId: IntegrationProviderId): providerId is ConfigurableProviderId =>
  providerId === 'slack' || providerId === 'discord' || providerId === 'zapier';

/** A webhook connection's stored label, or blank. */
const storedLabelOf = (connection: IntegrationCatalogEntry['connection']) => {
  const config = connection?.config;
  return config?.providerId === 'slack' || config?.providerId === 'discord' || config?.providerId === 'zapier' ? (config.label ?? '') : '';
};

const isComingSoon = (entry: IntegrationCatalogEntry) => entry.availability === 'coming_soon';
const newIdempotencyKey = () => randomUUID();

const STATE_BADGE: Partial<Record<CardState['kind'], { label: MessageKey; tone: StatusBadgeTone }>> = {
  connected: { label: 'settings.integrations.connected', tone: 'success' },
  paused: { label: 'settings.integrations.status.paused', tone: 'neutral' },
  notWorking: { label: 'settings.integrations.status.notWorking', tone: 'danger' },
  comingSoon: { label: 'settings.integrations.availability.comingSoon', tone: 'neutral' },
  notSendingYet: { label: 'settings.integrations.status.notSendingYet', tone: 'warning' },
};

/** The line under a card's name: what it does once connected, or what it would do. */
function CardText({ card }: { card: HubCard }) {
  const t = useT();
  const { state, entry } = card;
  const line: CardLine | null = 'line' in state ? state.line : null;
  if (state.kind === 'comingSoon' || state.kind === 'notSendingYet') return <>{t('settings.integrations.comingSoon.description')}</>;
  if (state.kind === 'notWorking') return <>{t('settings.integrations.notWorkingLine')}</>;
  if (!line) return <>{t(metaOf(entry.id).description)}</>;
  if (line.kind === 'syncing')
    return (
      <>
        {t('settings.integrations.line.syncing')}{' '}
        <bdi className="font-mono" dir="ltr">
          {line.repository}
        </bdi>{' '}
        · <bdi dir="ltr">{line.branch}</bdi>
      </>
    );
  if (line.kind === 'tracking')
    return (
      <>
        {t('settings.integrations.line.tracking')}{' '}
        <bdi className="font-mono" dir="ltr">
          {line.id}
        </bdi>
      </>
    );
  return line.label ? (
    <>
      {t('settings.integrations.line.posts')} <bdi>{line.label}</bdi>
    </>
  ) : (
    t(metaOf(entry.id).description)
  );
}

const cardClassName = 'flex min-h-20 w-full min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-4 text-start';
const linkCardClassName = cn(
  cardClassName,
  'outline-none transition-colors hover:border-foreground/20 hover:bg-muted/30 focus-visible:ring-3 focus-visible:ring-ring/50',
);

/**
 * One integration: icon, name, one line, and at the end either its status or
 * its one action. The whole card is a link when there is somewhere to go.
 */
function IntegrationCard({ card, projectId }: { card: HubCard; projectId: string }) {
  const t = useT();
  const meta = metaOf(card.entry.id);
  const Icon = meta.icon;
  const badge = STATE_BADGE[card.state.kind];
  const body = (
    <>
      <span aria-hidden className={cn('grid size-10 shrink-0 place-items-center rounded-lg', meta.tint)}>
        <Icon className="size-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium text-sm">{t(meta.name)}</span>
        <span className="mt-0.5 break-words text-muted-foreground text-sm">
          <CardText card={card} />
        </span>
      </span>
      {badge ? (
        <StatusBadge className="shrink-0" tone={badge.tone}>
          {t(badge.label)}
        </StatusBadge>
      ) : card.state.kind === 'setUp' ? (
        // A link styled as its action: the card is the control, so this is not a second button.
        <span className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'pointer-events-none shrink-0')}>
          {t(card.state.action === 'connect' ? 'settings.integrations.connect' : 'settings.integrations.setUp')}
        </span>
      ) : null}
    </>
  );
  if (!card.target) {
    return (
      <div className={cn(cardClassName, 'border-dashed')} data-coming-soon="">
        {body}
      </div>
    );
  }
  if (card.target.kind === 'git') {
    return (
      <Link className={linkCardClassName} params={{ projectId }} search={{ section: 'git' }} to="/app/projects/$projectId/settings">
        {body}
      </Link>
    );
  }
  return (
    <Link
      className={linkCardClassName}
      params={{ projectId }}
      search={{ section: 'integrations', integration: card.target.id }}
      to="/app/projects/$projectId/settings"
    >
      {body}
    </Link>
  );
}

/** The hub's shape on first load: two groups of two cards. */
function HubSkeleton() {
  const t = useT();
  return (
    <div aria-busy="true" className="flex flex-col gap-8">
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      {['first', 'second'].map((group) => (
        <div aria-hidden className="flex flex-col gap-3" key={group}>
          <Skeleton className="h-4 w-28" />
          <div className="grid gap-3 sm:grid-cols-2">
            {['a', 'b'].map((card) => (
              <div className={cardClassName} data-slot="integration-card-skeleton" key={card}>
                <Skeleton className="size-10 shrink-0 rounded-lg" />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3.5 w-3/4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** The way back from an integration's page to the hub. */
function BackToHub({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <Link
      className="-ms-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      params={{ projectId }}
      search={{ section: 'integrations' }}
      to="/app/projects/$projectId/settings"
    >
      <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
      {t('settings.integrations.allIntegrations')}
    </Link>
  );
}

function ConfirmationDialog({
  open,
  destructive,
  title,
  description,
  confirmLabel,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  destructive?: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={pending} onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t('common.cancel')}
          </Button>
          <Button loading={pending} onClick={onConfirm} type="button" variant={destructive ? 'destructive' : 'default'}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** An integration's page: back to the hub, then the integration's name, status and one line. */
function DetailHeader({ entry, projectId, comingSoon }: { entry: IntegrationCatalogEntry; projectId: string; comingSoon?: boolean }) {
  const t = useT();
  const meta = metaOf(entry.id);
  const Icon = meta.icon;
  const card = hubCard(entry);
  const badge = card ? STATE_BADGE[card.state.kind] : undefined;
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden className={cn('mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg', meta.tint)}>
        <Icon className="size-5" />
      </span>
      <PageHeader
        back={<BackToHub projectId={projectId} />}
        badge={badge ? <StatusBadge tone={badge.tone}>{t(badge.label)}</StatusBadge> : null}
        className="min-w-0 flex-1"
        description={t(comingSoon ? 'settings.integrations.comingSoon.description' : meta.description)}
        title={t(meta.name)}
      />
    </div>
  );
}

/**
 * A provider that delivers nothing yet ("Coming soon"): a stored connection can
 * only be removed. No test, no edit, no activation.
 */
function ComingSoonDetail({
  entry,
  projectId,
  onRemove,
  pending,
  removeOpen,
  setRemoveOpen,
}: {
  entry: IntegrationCatalogEntry;
  projectId: string;
  onRemove: () => void;
  pending: boolean;
  removeOpen: boolean;
  setRemoveOpen: (open: boolean) => void;
}) {
  const t = useT();
  const name = t(metaOf(entry.id).name);
  const label = storedLabelOf(entry.connection);
  return (
    <div className="flex flex-col gap-8">
      <DetailHeader comingSoon entry={entry} projectId={projectId} />
      {entry.connection ? (
        <SettingsSection title={t('settings.integrations.status.notSendingYet')} description={t('settings.integrations.comingSoon.saved')}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            {label ? (
              <p className="min-w-0 break-words font-medium text-sm">
                <bdi>{label}</bdi>
              </p>
            ) : (
              <span />
            )}
            <Button disabled={pending} onClick={() => setRemoveOpen(true)} type="button" variant="destructive">
              <Trash2 />
              {t('settings.integrations.remove')}
            </Button>
          </div>
        </SettingsSection>
      ) : null}
      <ConfirmationDialog
        confirmLabel={t('settings.integrations.remove')}
        description={t('settings.integrations.removeDescription', { name })}
        destructive
        onConfirm={onRemove}
        onOpenChange={setRemoveOpen}
        open={removeOpen}
        pending={pending}
        title={t('settings.integrations.removeTitle', { name })}
      />
    </div>
  );
}

/** A webhook integration's page (Slack, Discord, Zapier). */
function WebhookDetail({ projectId, entry }: { projectId: string; entry: IntegrationCatalogEntry }) {
  const t = useT();
  const navigate = useNavigate();
  const meta = metaOf(entry.id);
  const connection = entry.connection;
  const saveCommand = useWebhookIntegrationSaveCommand({ projectId, providerId: entry.id, providerName: meta.name });
  const activate = useActivateProjectIntegration(projectId);
  const deactivate = useDeactivateProjectIntegration(projectId);
  const verify = useVerifyProjectIntegration(projectId);
  const remove = useDeleteProjectIntegration(projectId);
  const storedLabel = storedLabelOf(connection);
  const revision = connection?.revision ?? 0;
  const [label, setLabel] = useState(storedLabel);
  // The stored label the field last took. A new revision (a save, a reread after a conflict) replaces an
  // untouched label and keeps an edit, as it keeps a typed URL.
  const [adopted, setAdopted] = useState({ revision, label: storedLabel });
  if (adopted.revision !== revision) {
    setAdopted({ revision, label: storedLabel });
    if (label === adopted.label) setLabel(storedLabel);
  }
  const [webhookUrl, setWebhookUrl] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const pending = saveCommand.pending || activate.isPending || deactivate.isPending || verify.isPending || remove.isPending;
  const backToHub = () => navigate({ to: '/app/projects/$projectId/settings', params: { projectId }, search: { section: 'integrations' } });

  async function deleteConnection() {
    if (pending) return;
    if (!connection || !isConfigurableProvider(entry.id)) return;
    try {
      await remove.mutateAsync({ providerId: entry.id, expectedRevision: connection.revision });
      setDeleteOpen(false);
      toast.success(isComingSoon(entry) ? t('settings.integrations.removedToast', { name: t(meta.name) }) : t('settings.integrations.deletedToast'));
      void backToHub();
    } catch {
      // Toasted in plain words by the mutation (meta.errorMessage).
    }
  }

  if (isComingSoon(entry)) {
    return (
      <ComingSoonDetail
        entry={entry}
        onRemove={deleteConnection}
        pending={remove.isPending}
        projectId={projectId}
        removeOpen={deleteOpen}
        setRemoveOpen={setDeleteOpen}
      />
    );
  }

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!isConfigurableProvider(entry.id)) return;
    if (!connection && !webhookUrl) {
      toast.error(t('settings.integrations.webhookRequired'));
      return;
    }
    saveCommand.save({ projectId, providerId: entry.id, revision: connection?.revision ?? null, label }, webhookUrl, () => setWebhookUrl(''));
  };

  const changeStatus = async () => {
    if (pending) return;
    if (!connection || !isConfigurableProvider(entry.id)) return;
    try {
      const mutation = connection.status === 'inactive' ? activate : deactivate;
      await mutation.mutateAsync({ providerId: entry.id, body: { expectedRevision: connection.revision, idempotencyKey: newIdempotencyKey() } });
      toast.success(t(connection.status === 'inactive' ? 'settings.integrations.activatedToast' : 'settings.integrations.deactivatedToast'));
    } catch {
      // Toasted in plain words by the mutation (meta.errorMessage).
    }
  };

  const runVerify = async (confirmed = false) => {
    if (pending) return;
    if (entry.verificationSideEffect && !confirmed) {
      setVerifyOpen(true);
      return;
    }
    try {
      const body =
        isConfigurableProvider(entry.id) && connection
          ? {
              providerId: entry.id,
              expectedRevision: connection.revision,
              idempotencyKey: newIdempotencyKey(),
              ...(entry.verificationSideEffect ? { confirmExternalSideEffect: true } : {}),
            }
          : null;
      if (!body) return;
      await verify.mutateAsync({ providerId: entry.id, body });
      setVerifyOpen(false);
      toast.success(t('settings.integrations.verifiedToast'));
    } catch {
      // Toasted in plain words by the mutation (meta.errorMessage).
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <DetailHeader entry={entry} projectId={projectId} />
      <SettingsSection title={t('settings.integrations.configuration')} description={t('settings.integrations.webhookDescription')}>
        <form className="flex flex-col gap-4" onSubmit={save}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${entry.id}-label`}>{t('settings.integrations.field.label')}</Label>
              <Input
                {...NO_AUTOFILL_PROPS}
                id={`${entry.id}-label`}
                maxLength={80}
                name={`${entry.id}-integration-label`}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t('settings.integrations.labelPlaceholder')}
                value={label}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${entry.id}-url`}>{t('settings.integrations.webhookUrl')}</Label>
              <SecretInput
                id={`${entry.id}-url`}
                inputMode="url"
                name={`${entry.id}-webhook-url`}
                onChange={(event) => {
                  setWebhookUrl(event.target.value);
                  saveCommand.retire();
                }}
                placeholder={connection ? t('settings.integrations.credentialKept') : t(PLACEHOLDER_KEYS[entry.id as ConfigurableProviderId])}
                required={!connection}
                value={webhookUrl}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            <ShieldCheck className="me-1 inline size-3.5" />
            {t('settings.integrations.credentialPrivacy')}
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button disabled={pending} loading={saveCommand.pending} type="submit">
              {connection ? t('common.save') : t('settings.integrations.connect')}
            </Button>
            {connection ? (
              <Button disabled={pending} loading={activate.isPending || deactivate.isPending} onClick={changeStatus} type="button" variant="outline">
                {connection.status === 'inactive' ? t('settings.integrations.activate') : t('settings.integrations.deactivate')}
              </Button>
            ) : null}
            {connection && (entry.supportsPassiveVerification || entry.verificationSideEffect) ? (
              <Button
                disabled={pending || connection.status !== 'active'}
                loading={verify.isPending && !verifyOpen}
                onClick={() => runVerify()}
                type="button"
                variant="outline"
              >
                <RefreshCw />
                {t(entry.verificationSideEffect ? 'settings.integrations.sendTest' : 'settings.integrations.verify')}
              </Button>
            ) : null}
            {connection ? (
              <Button className="sm:ms-auto" disabled={pending} onClick={() => setDeleteOpen(true)} type="button" variant="destructive">
                <Trash2 />
                {t('common.delete')}
              </Button>
            ) : null}
          </div>
        </form>
      </SettingsSection>

      <ConfirmationDialog
        confirmLabel={t('settings.integrations.sendTest')}
        description={t('settings.integrations.sendTestDescription')}
        onConfirm={() => runVerify(true)}
        onOpenChange={setVerifyOpen}
        open={verifyOpen}
        pending={verify.isPending}
        title={t('settings.integrations.sendTestTitle')}
      />
      <ConfirmationDialog
        confirmLabel={t('common.delete')}
        description={t('settings.integrations.deleteDescription', { name: t(meta.name) })}
        destructive
        onConfirm={deleteConnection}
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        pending={remove.isPending}
        title={t('settings.integrations.deleteTitle')}
      />
    </div>
  );
}

/**
 * Settings → Integrations (operations/ux/ai-and-integrations.md §4.4): only
 * what a site owner connects, grouped by job, with AI keys pointed to their
 * own page. The open integration is in the URL (`integration`), so Back
 * closes it and a link can point at it.
 */
type IntegrationsTabProps = { projectId: string; project: Project; integration?: IntegrationDetailId };

export function IntegrationsTab(props: IntegrationsTabProps) {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef(props.integration);
  useEffect(() => {
    if (shown.current === props.integration) return;
    shown.current = props.integration;
    // Opening an integration, or going back to the hub, starts keyboard and screen reader users at the new
    // page's heading, as changing settings page does; the link they followed is gone.
    ref.current?.querySelector<HTMLElement>('h1')?.focus();
  }, [props.integration]);
  return (
    <div ref={ref}>
      <IntegrationsView {...props} />
    </div>
  );
}

function IntegrationsView({ projectId, project, integration }: IntegrationsTabProps) {
  const t = useT();
  const integrations = useProjectIntegrations(projectId);

  if (integration === 'analytics') {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader
          back={<BackToHub projectId={projectId} />}
          description={t('settings.integrations.analytics.description')}
          title={t('settings.analytics.title')}
        />
        <AnalyticsSettings project={project} />
      </div>
    );
  }
  const opened = integration && integrations.data ? detailEntry(integrations.data, integration) : null;
  if (opened) return <WebhookDetail entry={opened} key={opened.id} projectId={projectId} />;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader description={t('settings.integrations.subtitle')} title={t('settings.integrations.title')} />
      {integrations.isPending ? <HubSkeleton /> : null}
      {integrations.isError && !integrations.data ? (
        <Callout
          action={
            <Button loading={integrations.isFetching} onClick={() => void integrations.refetch()} size="sm" variant="outline">
              {t('common.retry')}
            </Button>
          }
          title={t('settings.integrations.loadError')}
          tone="danger"
        >
          {t('settings.integrations.loadErrorDescription')}
        </Callout>
      ) : null}
      {integrations.data
        ? hubGroups(integrations.data).map((group) => (
            <section aria-labelledby={`integrations-${group.id}`} className="flex flex-col gap-3" key={group.id}>
              <h2 className="font-semibold text-base" id={`integrations-${group.id}`}>
                {t(GROUP_KEYS[group.id])}
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {group.cards.map((card) => (
                  <li className="flex min-w-0" key={card.entry.id}>
                    <IntegrationCard card={card} projectId={projectId} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        : null}
      {integrations.data ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border border-dashed p-4" data-slot="ai-keys-pointer">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <Bot className="size-5" />
          </span>
          <p className="min-w-0 flex-1 basis-56 text-muted-foreground text-sm">{t('settings.integrations.aiPointer', { page: t('settings.ai') })}</p>
          <Button
            nativeButton={false}
            render={<Link params={{ projectId }} search={{ section: 'ai' }} to="/app/projects/$projectId/settings" />}
            size="sm"
            variant="outline"
          >
            {t('settings.integrations.openAiPage', { page: t('settings.ai') })}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
