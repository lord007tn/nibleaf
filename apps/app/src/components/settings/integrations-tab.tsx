import { useDebouncedCallback } from '@tanstack/react-pacer';
import { ArrowLeft, MessageSquare, Zap } from 'lucide-react';
import { type ComponentType, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { GithubIcon, GitlabIcon, SlackIcon } from '@/components/icons/brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateWorkspaceSettings, useWorkspaceSettings } from '@/hooks/api';
import { cn } from '@/lib/utils';
import { SettingsSection } from './section';

interface ProviderField {
  key: string;
  label: string;
  placeholder: string;
}

interface Provider {
  id: string;
  name: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tint: string;
  fields: ProviderField[];
}

const PROVIDERS: Provider[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Sync docs from a repository and trigger deploys on push.',
    icon: GithubIcon,
    tint: 'bg-foreground/10 text-foreground',
    fields: [
      { key: 'org', label: 'Organization', placeholder: 'acme-inc' },
      { key: 'repo', label: 'Repository', placeholder: 'acme-inc/docs' },
    ],
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Connect a GitLab project to host content as files.',
    icon: GitlabIcon,
    tint: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
    fields: [
      { key: 'project', label: 'Project path', placeholder: 'group/docs' },
      { key: 'instance', label: 'Instance URL', placeholder: 'https://gitlab.com' },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Get deploy and comment notifications in a channel.',
    icon: SlackIcon,
    tint: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
    fields: [{ key: 'channel', label: 'Channel', placeholder: '#docs' }],
  },
  {
    id: 'discord',
    name: 'Discord',
    description: 'Post workspace activity to a Discord webhook.',
    icon: MessageSquare,
    tint: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
    fields: [{ key: 'webhook', label: 'Webhook URL', placeholder: 'https://discord.com/api/webhooks/…' }],
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'Automate workflows with thousands of apps.',
    icon: Zap,
    tint: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    fields: [{ key: 'apiKey', label: 'API key', placeholder: 'zap_••••••••' }],
  },
];

interface IntegrationState {
  connected: boolean;
  config: Record<string, string>;
}

/** Normalise the persisted integrations blob (which may hold legacy booleans). */
function readState(raw: unknown): IntegrationState {
  if (typeof raw === 'boolean') {
    return { connected: raw, config: {} };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { connected?: unknown; config?: unknown };
    return {
      connected: Boolean(obj.connected),
      config: (obj.config && typeof obj.config === 'object' ? (obj.config as Record<string, string>) : {}),
    };
  }
  return { connected: false, config: {} };
}

function ConnectedPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-4xl bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-600 text-xs dark:text-emerald-400">
      <span className="size-1.5 rounded-full bg-emerald-500" /> Connected
    </span>
  );
}

function NotConnectedPill() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-4xl border border-border px-2.5 py-1 font-medium text-muted-foreground text-xs">
      <span className="size-1.5 rounded-full bg-muted-foreground/40" /> Not connected
    </span>
  );
}

function IntegrationDetail({
  provider,
  integrations,
  onBack,
}: {
  provider: Provider;
  integrations: Record<string, unknown>;
  onBack: () => void;
}) {
  const update = useUpdateWorkspaceSettings();
  const persisted = readState(integrations[provider.id]);
  const [connected, setConnected] = useState(persisted.connected);
  const [config, setConfig] = useState<Record<string, string>>(persisted.config);
  const Icon = provider.icon;

  const persist = (next: IntegrationState) =>
    update.mutate({ integrations: { ...integrations, [provider.id]: next } });

  // Debounced autosave for field edits so we don't fire a request per keystroke.
  const saveConfig = useDebouncedCallback(
    (nextConfig: Record<string, string>) => persist({ connected, config: nextConfig }),
    { wait: 700 },
  );

  const onFieldChange = (key: string, value: string) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    saveConfig(next);
  };

  const toggleConnection = () => {
    const next = !connected;
    setConnected(next);
    persist({ connected: next, config });
    toast.success(next ? `${provider.name} connected` : `${provider.name} disconnected`);
  };

  const saveChanges = () =>
    update.mutate(
      { integrations: { ...integrations, [provider.id]: { connected, config } } },
      {
        onSuccess: () => toast.success('Changes saved'),
        onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save changes'),
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <button
        className="flex w-fit cursor-pointer items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="size-4" /> All integrations
      </button>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <span className={cn('grid size-12 shrink-0 place-items-center rounded-xl', provider.tint)}>
            <Icon className="size-6" />
          </span>
          <div className="min-w-0 flex-1 leading-snug">
            <div className="font-semibold text-lg tracking-tight">{provider.name}</div>
            <p className="mt-0.5 text-muted-foreground text-sm">{provider.description}</p>
          </div>
          {connected ? <ConnectedPill /> : <NotConnectedPill />}
        </div>
      </section>

      <SettingsSection title="Configuration">
        <div className="flex flex-col gap-4">
          {provider.fields.map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <Label className="text-muted-foreground" htmlFor={`${provider.id}-${field.key}`}>
                {field.label}
              </Label>
              <Input
                className="font-mono"
                id={`${provider.id}-${field.key}`}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
                placeholder={field.placeholder}
                value={config[field.key] ?? ''}
              />
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center gap-2.5">
          <Button disabled={update.isPending} variant={connected ? 'outline' : 'default'} onClick={toggleConnection}>
            {connected ? 'Disconnect' : 'Connect'}
          </Button>
          <Button disabled={update.isPending} variant="outline" onClick={saveChanges}>
            Save changes
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}

export function IntegrationsTab() {
  const { data } = useWorkspaceSettings();
  const integrations = useMemo(() => (data?.integrations ?? {}) as Record<string, unknown>, [data?.integrations]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = PROVIDERS.find((p) => p.id === selectedId) ?? null;

  if (selected) {
    return (
      <IntegrationDetail
        key={selected.id}
        integrations={integrations}
        onBack={() => setSelectedId(null)}
        provider={selected}
      />
    );
  }

  return (
    <SettingsSection title="Integrations" description="Connect Plume to the tools your team already uses.">
      <div className="flex flex-col">
        {PROVIDERS.map((provider) => {
          const connected = readState(integrations[provider.id]).connected;
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
                  {connected ? <ConnectedPill /> : <NotConnectedPill />}
                </div>
                <p className="mt-0.5 text-muted-foreground text-sm">{provider.description}</p>
              </div>
              <span className="text-muted-foreground text-sm">{connected ? 'Manage' : 'Connect'}</span>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}
