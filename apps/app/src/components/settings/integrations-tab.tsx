import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { cn } from '@nibleaf/design-system/lib/utils';
import { ArrowLeft, MessageSquare, Zap } from 'lucide-react';
import { type ComponentType, useMemo, useState } from 'react';
import { GithubIcon, GitlabIcon, SlackIcon } from '@/components/icons/brand';
import { useWorkspaceSettings } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
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

const PROVIDERS: Provider[] = [
  {
    id: 'github',
    name: 'GitHub',
    descriptionKey: 'settings.integrations.github.description',
    icon: GithubIcon,
    tint: 'bg-foreground/10 text-foreground',
    fields: [
      { key: 'org', labelKey: 'settings.integrations.github.org', placeholder: 'acme-inc' },
      { key: 'repo', labelKey: 'settings.integrations.github.repo', placeholder: 'acme-inc/docs' },
    ],
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    descriptionKey: 'settings.integrations.gitlab.description',
    icon: GitlabIcon,
    tint: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    fields: [
      { key: 'project', labelKey: 'settings.integrations.gitlab.project', placeholder: 'group/docs' },
      { key: 'instance', labelKey: 'settings.integrations.gitlab.instance', placeholder: 'https://gitlab.com' },
    ],
  },
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
    tint: 'bg-stone-500/15 text-stone-700 dark:text-stone-300',
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

/** Normalise the persisted integrations blob (which may hold legacy booleans). */
function readConfig(raw: unknown): Record<string, string> {
  if (raw && typeof raw === 'object') {
    const obj = raw as { config?: unknown };
    return obj.config && typeof obj.config === 'object' ? (obj.config as Record<string, string>) : {};
  }
  return {};
}

function NotConnectedPill() {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 rounded-4xl border border-border px-2.5 py-1 font-medium text-muted-foreground text-xs">
      <span className="size-1.5 rounded-full bg-muted-foreground/40" /> {t('settings.integrations.notConnected')}
    </span>
  );
}

function IntegrationDetail({ provider, integrations, onBack }: { provider: Provider; integrations: Record<string, unknown>; onBack: () => void }) {
  const t = useT();
  const config = readConfig(integrations[provider.id]);
  const Icon = provider.icon;

  return (
    <div className="flex flex-col gap-4">
      <button
        className="flex w-fit cursor-pointer items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-4" /> {t('settings.integrations.allIntegrations')}
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
          <NotConnectedPill />
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

export function IntegrationsTab({ projectId }: { projectId?: string }) {
  const t = useT();
  const { data } = useWorkspaceSettings(projectId);
  const integrations = useMemo(() => (data?.integrations ?? {}) as Record<string, unknown>, [data?.integrations]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = PROVIDERS.find((p) => p.id === selectedId) ?? null;

  if (selected) {
    return <IntegrationDetail key={selected.id} integrations={integrations} onBack={() => setSelectedId(null)} provider={selected} />;
  }

  return (
    <SettingsSection title={t('settings.integrations.title')} description={t('settings.integrations.subtitle')}>
      <div className="flex flex-col">
        {PROVIDERS.map((provider) => {
          const Icon = provider.icon;
          return (
            <button
              key={provider.id}
              className="flex cursor-pointer items-center gap-4 border-border border-t py-4 text-start first:border-t-0 hover:bg-muted/40"
              onClick={() => setSelectedId(provider.id)}
              type="button"
            >
              <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', provider.tint)}>
                <Icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1 leading-snug">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{provider.name}</span>
                  <NotConnectedPill />
                </div>
                <p className="mt-0.5 text-muted-foreground text-sm">{t(provider.descriptionKey)}</p>
              </div>
              <span className="text-muted-foreground text-sm">{t('settings.integrations.view')}</span>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}
