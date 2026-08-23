import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, BarChart3, MessageSquare, Zap } from 'lucide-react';
import { type ComponentType, useMemo, useState } from 'react';
import { GithubIcon, SlackIcon } from '@/components/icons/brand';
import { AnalyticsSection } from '@/components/project-settings/analytics-section';
import type { Project } from '@/hooks/api';
import { useWorkspaceSettings } from '@/hooks/api';
import { SettingsSection } from './section';

interface ProviderField {
  key: string;
  /** i18n key for the field label, resolved through `t` at render time. */
  labelKey: MessageKey;
  placeholder: string;
}

interface Provider {
  id: string;
  name: string;
  /** i18n key for the provider description, resolved through `t` at render time. */
  descriptionKey: MessageKey;
  icon: ComponentType<{ className?: string }>;
  tint: string;
  fields: ProviderField[];
}

// Third-party notification/automation providers — configuration is stored but
// delivery is not wired up yet, so they present as "not connected" stubs.
// (Git providers are NOT listed here: repository import/sync has a real,
// functional home in the Git section.)
const PROVIDERS: Provider[] = [
  {
    id: 'slack',
    name: 'Slack',
    descriptionKey: 'settings.integrations.slack.description',
    icon: SlackIcon,
    tint: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    fields: [{ key: 'channel', labelKey: 'settings.integrations.slack.channel', placeholder: '#docs' }],
  },
  {
    id: 'discord',
    name: 'Discord',
    descriptionKey: 'settings.integrations.discord.description',
    icon: MessageSquare,
    tint: 'bg-foreground/10 text-foreground',
    fields: [{ key: 'webhook', labelKey: 'settings.integrations.discord.webhook', placeholder: 'https://discord.com/api/webhooks/…' }],
  },
  {
    id: 'zapier',
    name: 'Zapier',
    descriptionKey: 'settings.integrations.zapier.description',
    icon: Zap,
    tint: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    fields: [{ key: 'apiKey', labelKey: 'settings.integrations.zapier.apiKey', placeholder: 'zap_••••••••' }],
  },
];

function StatusPill({ connected }: { connected?: boolean }) {
  const t = useT();
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-4xl border px-2.5 py-1 font-medium text-xs',
        connected ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'border-border text-muted-foreground',
      )}
    >
      <span className={cn('size-1.5 rounded-full', connected ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
      {connected ? t('settings.integrations.connected') : t('settings.integrations.notConnected')}
    </span>
  );
}

function ProviderRow({
  icon: Icon,
  tint,
  name,
  description,
  connected,
  action,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>;
  tint: string;
  name: string;
  description: string;
  connected?: boolean;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex cursor-pointer items-center gap-4 border-border border-t py-4 text-start outline-none first:border-t-0 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={onClick}
      type="button"
    >
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', tint)}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1 leading-snug">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{name}</span>
          <StatusPill connected={connected} />
        </div>
        <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
      </div>
      <span className="shrink-0 text-muted-foreground text-sm">{action}</span>
    </button>
  );
}

function IntegrationDetail({ provider, integrations, onBack }: { provider: Provider; integrations: Record<string, unknown>; onBack: () => void }) {
  const t = useT();
  const config = (integrations[provider.id] as { config?: Record<string, string> } | undefined)?.config ?? {};
  const Icon = provider.icon;

  return (
    <div className="flex flex-col gap-4">
      <button
        className="flex w-fit cursor-pointer items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('settings.integrations.allIntegrations')}
      </button>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <span className={cn('grid size-12 shrink-0 place-items-center rounded-xl', provider.tint)}>
            <Icon className="size-6" />
          </span>
          <div className="min-w-0 flex-1 leading-snug">
            <div className="font-semibold text-lg tracking-tight">{provider.name}</div>
            <p className="mt-0.5 text-muted-foreground text-sm">{t(provider.descriptionKey)}</p>
          </div>
          <StatusPill />
        </div>
      </section>

      <SettingsSection title={t('settings.integrations.configuration')}>
        <p className="mb-4 text-muted-foreground text-sm leading-relaxed">{t('settings.integrations.selfHostedUnavailable')}</p>
        <div className="flex flex-col gap-4">
          {provider.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground" htmlFor={`${provider.id}-${field.key}`}>
                {t(field.labelKey)}
              </Label>
              <Input
                className="font-mono"
                disabled
                id={`${provider.id}-${field.key}`}
                placeholder={field.placeholder}
                value={config[field.key] ?? ''}
              />
            </div>
          ))}
        </div>
      </SettingsSection>
    </div>
  );
}

/** Analytics lives under Integrations (it wires the published site to external
 *  trackers) — the detail view reuses the full AnalyticsSection form. */
function AnalyticsDetail({ project, onBack }: { project: Project; onBack: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <button
        className="flex w-fit cursor-pointer items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('settings.integrations.allIntegrations')}
      </button>
      <AnalyticsSection project={project} />
    </div>
  );
}

export function IntegrationsTab({ projectId, project }: { projectId?: string; project?: Project }) {
  const t = useT();
  const navigate = useNavigate();
  const { data } = useWorkspaceSettings(projectId);
  const integrations = useMemo(() => (data?.integrations ?? {}) as Record<string, unknown>, [data?.integrations]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = PROVIDERS.find((p) => p.id === selectedId) ?? null;
  if (selectedId === 'analytics' && project) {
    return <AnalyticsDetail project={project} onBack={() => setSelectedId(null)} />;
  }
  if (selected) {
    return <IntegrationDetail key={selected.id} integrations={integrations} onBack={() => setSelectedId(null)} provider={selected} />;
  }

  const analytics = project?.config?.analytics;
  const analyticsConnected = Boolean(analytics?.ga4 || analytics?.plausible);
  const gitMeta = (data?.git ?? null) as { connected?: boolean } | null;

  return (
    <SettingsSection title={t('settings.integrations.title')} description={t('settings.integrations.subtitle')}>
      <div className="flex flex-col">
        {project ? (
          <ProviderRow
            icon={BarChart3}
            tint="bg-primary/10 text-primary"
            name={t('settings.analytics.title')}
            description={t('settings.integrations.analytics.description')}
            connected={analyticsConnected}
            action={analyticsConnected ? t('settings.integrations.view') : t('settings.integrations.configure')}
            onClick={() => setSelectedId('analytics')}
          />
        ) : null}
        {projectId ? (
          <ProviderRow
            icon={GithubIcon}
            tint="bg-foreground/10 text-foreground"
            name={t('settings.integrations.gitSync.title')}
            description={t('settings.integrations.gitSync.description')}
            connected={Boolean(gitMeta?.connected)}
            action={t('settings.integrations.configure')}
            onClick={() => navigate({ to: '/app/projects/$projectId/settings', params: { projectId }, search: { section: 'git' }, replace: true })}
          />
        ) : null}
        {PROVIDERS.map((provider) => (
          <ProviderRow
            key={provider.id}
            icon={provider.icon}
            tint={provider.tint}
            name={provider.name}
            description={t(provider.descriptionKey)}
            action={t('settings.integrations.view')}
            onClick={() => setSelectedId(provider.id)}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
