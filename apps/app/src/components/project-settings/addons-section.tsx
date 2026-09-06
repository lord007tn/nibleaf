import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@nibleaf/design-system/components/ui/accordion';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { AddonGroup, AddonId } from '@nibleaf/shared/addons';
import { Blocks, CheckCircle2, MessageSquareText, Rocket, ShieldCheck, TriangleAlert } from 'lucide-react';
import { type ComponentType, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import type { ProjectAddon } from '@/hooks/api';
import { useActivateProjectAddon, useDeactivateProjectAddon, useProjectAddons, useUpdateProjectAddon } from '@/hooks/api';
import { SectionHeader } from './shared';

const GROUPS = [
  { id: 'engagement', icon: MessageSquareText },
  { id: 'privacy', icon: ShieldCheck },
  { id: 'publishing', icon: Rocket },
] as const satisfies ReadonlyArray<{ id: AddonGroup; icon: ComponentType<{ className?: string }> }>;

const ADDON_KEYS: Record<AddonId, { title: MessageKey; description: MessageKey }> = {
  feedback: { title: 'settings.addons.feedback.title', description: 'settings.addons.feedback.hint' },
  'edit-suggestions': { title: 'settings.addons.editSuggestions.title', description: 'settings.addons.editSuggestions.hint' },
  'issue-links': { title: 'settings.addons.issueLinks.title', description: 'settings.addons.issueLinks.hint' },
  'consent-banner': { title: 'settings.addons.consent.title', description: 'settings.addons.consent.description' },
  'ci-checks': { title: 'settings.addons.ciChecks.title', description: 'settings.addons.ciChecks.hint' },
  'broken-links': { title: 'settings.addons.brokenLinks.title', description: 'settings.addons.brokenLinks.hint' },
  'grammar-linter': { title: 'settings.addons.grammarLinter.title', description: 'settings.addons.grammarLinter.hint' },
  'preview-deployments': { title: 'settings.addons.previewDeployments.title', description: 'settings.addons.previewDeployments.hint' },
};

const stringConfig = (config: Record<string, unknown>, key: string, fallback = '') => {
  const value = z.string().safeParse(config[key]);
  return value.success ? value.data : fallback;
};

/** Options for the configurable add-on selects. The values mirror the shared
 *  add-on config enums; one array feeds both the trigger label (`items`) and the
 *  rendered options so the two can't drift. */
type ConfigOption = { value: string; labelKey: MessageKey };
const FEEDBACK_PLACEMENT_OPTIONS = [
  { value: 'after-content', labelKey: 'settings.addons.feedback.placement.afterContent' },
  { value: 'after-navigation', labelKey: 'settings.addons.feedback.placement.afterNavigation' },
] as const satisfies ReadonlyArray<ConfigOption>;
const FEEDBACK_PRESENTATION_OPTIONS = [
  { value: 'compact', labelKey: 'settings.addons.feedback.presentation.compact' },
  { value: 'card', labelKey: 'settings.addons.feedback.presentation.card' },
] as const satisfies ReadonlyArray<ConfigOption>;
const CONSENT_PLACEMENT_OPTIONS = [
  { value: 'bottom-start', labelKey: 'settings.addons.consent.placement.start' },
  { value: 'bottom-center', labelKey: 'settings.addons.consent.placement.center' },
  { value: 'bottom-end', labelKey: 'settings.addons.consent.placement.end' },
] as const satisfies ReadonlyArray<ConfigOption>;
const CONSENT_PRESENTATION_OPTIONS = [
  { value: 'compact', labelKey: 'settings.addons.consent.presentation.compact' },
  { value: 'comfortable', labelKey: 'settings.addons.consent.presentation.comfortable' },
] as const satisfies ReadonlyArray<ConfigOption>;
const CONSENT_BUTTON_LAYOUT_OPTIONS = [
  { value: 'inline', labelKey: 'settings.addons.consent.buttons.inline' },
  { value: 'stacked', labelKey: 'settings.addons.consent.buttons.stacked' },
] as const satisfies ReadonlyArray<ConfigOption>;

function StatusBadge({ addon }: { addon: ProjectAddon }) {
  const t = useT();
  const statusKey = `settings.addons.status.${addon.status.replace('_', '')}` as MessageKey;
  return (
    <Badge variant={addon.status === 'unavailable' ? 'destructive' : addon.status === 'active' ? 'secondary' : 'outline'}>
      {addon.status === 'active' ? <CheckCircle2 aria-hidden /> : addon.status === 'needs_configuration' ? <TriangleAlert aria-hidden /> : null}
      {t(statusKey)}
    </Badge>
  );
}

function ConfigurationField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </div>
  );
}

function ConfigSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<ConfigOption>;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const items = options.map((option) => ({ value: option.value, label: t(option.labelKey) }));
  return (
    <ConfigurationField label={label}>
      <Select items={items} onValueChange={(next) => onChange(next ?? value)} value={value}>
        <SelectTrigger aria-label={label} className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </ConfigurationField>
  );
}

function AddonCard({ addon, projectId }: { addon: ProjectAddon; projectId: string }) {
  const t = useT();
  const update = useUpdateProjectAddon(projectId);
  const activate = useActivateProjectAddon(projectId);
  const deactivate = useDeactivateProjectAddon(projectId);
  const [draftConfig, setDraftConfig] = useState<Record<string, unknown> | null>(null);
  const config = draftConfig ?? addon.config;
  const configurable = ['feedback', 'edit-suggestions', 'issue-links', 'consent-banner'].includes(addon.id);
  const pending = update.isPending || activate.isPending || deactivate.isPending;
  const keys = ADDON_KEYS[addon.id];

  const save = () => {
    const nextConfig =
      addon.id === 'edit-suggestions' || addon.id === 'issue-links'
        ? (() => {
            const urlTemplate = stringConfig(config, 'urlTemplate').trim();
            return urlTemplate ? { urlTemplate } : {};
          })()
        : config;
    update.mutate(
      { addonId: addon.id, body: { config: nextConfig, expectedRevision: addon.revision } },
      {
        onSuccess: () => toast.success(t('common.saved')),
        onError: () => toast.error(t('settings.saveError')),
      },
    );
  };
  const toggle = (enabled: boolean) => {
    const mutation = enabled ? activate : deactivate;
    mutation.mutate(
      { addonId: addon.id, expectedRevision: addon.revision },
      {
        onSuccess: () => toast.success(t('common.saved')),
        onError: () => toast.error(t('settings.saveError')),
      },
    );
  };

  return (
    <article className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-sm">{t(keys.title)}</h4>
            <StatusBadge addon={addon} />
            {addon.availability.state === 'preview' ? <Badge variant="outline">{t('settings.addons.availability.preview')}</Badge> : null}
          </div>
          <p className="mt-1 text-muted-foreground text-sm leading-relaxed">{t(keys.description)}</p>
          {!addon.availability.available ? <p className="mt-2 text-destructive text-xs">{t('settings.addons.unavailableDescription')}</p> : null}
        </div>
        <Switch
          aria-label={t(addon.enabled ? 'settings.addons.disable' : 'settings.addons.enable', { name: t(keys.title) })}
          checked={addon.enabled}
          disabled={!addon.availability.available || pending}
          onCheckedChange={toggle}
        />
      </div>

      {configurable ? (
        <div className="mt-4 grid gap-4 border-border border-t pt-4">
          {addon.id === 'feedback' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ConfigSelect
                label={t('settings.addons.feedback.placement')}
                onChange={(placement) => setDraftConfig({ ...config, placement })}
                options={FEEDBACK_PLACEMENT_OPTIONS}
                value={stringConfig(config, 'placement', 'after-content')}
              />
              <ConfigSelect
                label={t('settings.addons.feedback.presentation')}
                onChange={(presentation) => setDraftConfig({ ...config, presentation })}
                options={FEEDBACK_PRESENTATION_OPTIONS}
                value={stringConfig(config, 'presentation', 'compact')}
              />
            </div>
          ) : null}

          {addon.id === 'edit-suggestions' || addon.id === 'issue-links' ? (
            <ConfigurationField label={t(addon.id === 'edit-suggestions' ? 'settings.addons.editUrl.label' : 'settings.addons.issueUrl.label')}>
              <Input
                aria-label={t(addon.id === 'edit-suggestions' ? 'settings.addons.editUrl.label' : 'settings.addons.issueUrl.label')}
                className="h-9 font-mono text-sm"
                onChange={(event) => setDraftConfig({ ...config, urlTemplate: event.target.value })}
                placeholder={
                  addon.id === 'edit-suggestions'
                    ? t('settings.addons.editUrl.placeholder', { path: '{path}' })
                    : t('settings.addons.issueUrl.placeholder', { url: '{url}' })
                }
                value={stringConfig(config, 'urlTemplate')}
              />
            </ConfigurationField>
          ) : null}

          {addon.id === 'consent-banner' ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <ConfigSelect
                  label={t('settings.addons.consent.placement')}
                  onChange={(placement) => setDraftConfig({ ...config, placement })}
                  options={CONSENT_PLACEMENT_OPTIONS}
                  value={stringConfig(config, 'placement', 'bottom-end')}
                />
                <ConfigSelect
                  label={t('settings.addons.consent.presentation')}
                  onChange={(presentation) => setDraftConfig({ ...config, presentation })}
                  options={CONSENT_PRESENTATION_OPTIONS}
                  value={stringConfig(config, 'presentation', 'comfortable')}
                />
                <ConfigSelect
                  label={t('settings.addons.consent.buttons')}
                  onChange={(buttonLayout) => setDraftConfig({ ...config, buttonLayout })}
                  options={CONSENT_BUTTON_LAYOUT_OPTIONS}
                  value={stringConfig(config, 'buttonLayout', 'inline')}
                />
              </div>
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3">
                <div className="font-medium text-xs uppercase tracking-wide">{t('settings.addons.consent.preview')}</div>
                <p className="mt-1 text-muted-foreground text-sm">{t('settings.addons.consent.previewDescription')}</p>
              </div>
            </>
          ) : null}

          <div className="flex justify-end">
            <Button className="h-9" disabled={pending} onClick={save} type="button">
              {pending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function AddonsSection({ projectId }: { projectId: string }) {
  const t = useT();
  const { data, isLoading, isError, refetch } = useProjectAddons(projectId);

  return (
    <div>
      <SectionHeader description={t('settings.addons.description')} icon={<Blocks className="size-4" />} title={t('settings.addons.title')} />
      {isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : null}
      {isError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p>{t('settings.addons.loadError')}</p>
          <Button className="mt-3" onClick={() => refetch()} size="sm" variant="outline">
            {t('common.retry')}
          </Button>
        </div>
      ) : null}
      {data ? (
        <Accordion className="overflow-hidden rounded-xl border border-border bg-card" defaultValue={['engagement']} multiple>
          {GROUPS.map((group) => {
            const items = data.filter((addon) => addon.group === group.id);
            const Icon = group.icon;
            return (
              <AccordionItem className="px-4 sm:px-5" key={group.id} value={group.id}>
                <AccordionTrigger className="items-center gap-3 py-4 hover:no-underline">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{t(`settings.addons.group.${group.id}.title` as MessageKey)}</span>
                      <span className="mt-0.5 block text-muted-foreground text-xs">
                        {t(`settings.addons.group.${group.id}.description` as MessageKey)}
                      </span>
                    </span>
                  </span>
                  <Badge className="ms-auto me-2" variant="outline">
                    {items.filter((addon) => addon.enabled).length}/{items.length}
                  </Badge>
                </AccordionTrigger>
                <AccordionContent className="grid gap-3 pb-5">
                  {items.map((addon) => (
                    <AddonCard addon={addon} key={`${addon.id}-${addon.revision}`} projectId={projectId} />
                  ))}
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      ) : null}
      <p className={cn('mt-4 text-muted-foreground text-xs', !data && 'hidden')}>{t('settings.addons.boundary')}</p>
    </div>
  );
}
