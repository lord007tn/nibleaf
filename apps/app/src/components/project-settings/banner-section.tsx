import { Input } from '@nibleaf/design-system/components/ui/input';
import type { LanguageConfig } from '@nibleaf/validators';
import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Language, Project } from '@/hooks/api';
import { useLanguages, useUpdateLanguage, useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import {
  DirtyStateReporter,
  FIELD_INPUT,
  Field,
  LanguageScopePicker,
  SaveBar,
  SectionHeader,
  saveConfigSection,
  ToggleRow,
  useScopeDirtyGuard,
} from './shared';

/** The editable banner values shared by the project scope and a language scope. */
interface BannerValues {
  enabled: boolean;
  dismissible: boolean;
  message: string;
  linkLabel: string;
  linkUrl: string;
}

/** Banner with a per-language scope: "Default" edits `project.config.banner`
 *  exactly as before; a language scope edits that language's `config.banner`
 *  override (message/link and, when overridden, its own enabled/dismissible). */
export function BannerSection({ project }: { project: Project }) {
  const t = useT();
  const { data: languages } = useLanguages(project.id);
  const extraLanguages = (languages ?? []).filter((language) => !language.isDefault);
  const [scope, setScope] = useState<string>('default');
  const activeLanguage = extraLanguages.find((language) => language.id === scope);
  const { guard, setDirty } = useScopeDirtyGuard();

  return (
    <div>
      <SectionHeader icon="⚑" title={t('settings.banner.title')} />
      <p className="mb-4 text-[13.5px] text-muted-foreground leading-relaxed">{t('settings.banner.description')}</p>
      <LanguageScopePicker guard={guard} hint={t('settings.banner.scope.hint')} languages={extraLanguages} onChange={setScope} value={scope} />
      {/* Keyed per scope so switching re-seeds the form from that scope's config. */}
      {activeLanguage ? (
        <LanguageBannerForm key={activeLanguage.id} language={activeLanguage} onDirtyChange={setDirty} project={project} />
      ) : (
        <ProjectBannerForm key="default" onDirtyChange={setDirty} project={project} />
      )}
    </div>
  );
}

/** Default scope: the project-level banner in `project.config.banner` (unchanged). */
function ProjectBannerForm({ project, onDirtyChange }: { project: Project; onDirtyChange?: (dirty: boolean) => void }) {
  const update = useUpdateProjectConfig(project.id);
  const banner = project.config?.banner ?? {};
  return (
    <BannerScopeForm
      onDirtyChange={onDirtyChange}
      initial={{
        enabled: banner.enabled ?? false,
        dismissible: banner.dismissible ?? true,
        message: banner.message ?? '',
        linkLabel: banner.linkLabel ?? '',
        linkUrl: banner.linkUrl ?? '',
      }}
      onSave={(value) =>
        saveConfigSection(update, {
          banner: {
            enabled: value.enabled,
            dismissible: value.dismissible,
            message: value.message.trim() || undefined,
            linkLabel: value.linkLabel.trim() || undefined,
            linkUrl: value.linkUrl.trim() || undefined,
          },
        })
      }
    />
  );
}

/** A language scope: that language's `config.banner` override. Text fields seed
 *  from the override only (placeholders show the project values); toggles seed
 *  from the override, falling back to the project's effective values. The
 *  override is stored when any text differs or a toggle diverges from the
 *  project banner; otherwise it is cleared (`null`) so the language falls back. */
function LanguageBannerForm({
  project,
  language,
  onDirtyChange,
}: {
  project: Project;
  language: Language;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const update = useUpdateLanguage(project.id);
  const projectBanner = project.config?.banner ?? {};
  const override: NonNullable<LanguageConfig['banner']> = language.config?.banner ?? {};

  return (
    <BannerScopeForm
      onDirtyChange={onDirtyChange}
      initial={{
        enabled: override.enabled ?? projectBanner.enabled ?? false,
        dismissible: override.dismissible ?? projectBanner.dismissible ?? true,
        message: override.message ?? '',
        linkLabel: override.linkLabel ?? '',
        linkUrl: override.linkUrl ?? '',
      }}
      placeholders={{
        message: projectBanner.message || undefined,
        linkLabel: projectBanner.linkLabel || undefined,
        linkUrl: projectBanner.linkUrl || undefined,
      }}
      onSave={async (value) => {
        const banner: NonNullable<LanguageConfig['banner']> = {};
        if (value.message.trim()) {
          banner.message = value.message.trim();
        }
        if (value.linkLabel.trim()) {
          banner.linkLabel = value.linkLabel.trim();
        }
        if (value.linkUrl.trim()) {
          banner.linkUrl = value.linkUrl.trim();
        }
        if (value.enabled !== (projectBanner.enabled ?? false)) {
          banner.enabled = value.enabled;
        }
        if (value.dismissible !== (projectBanner.dismissible ?? true)) {
          banner.dismissible = value.dismissible;
        }
        try {
          await update.mutateAsync({ id: language.id, body: { config: { banner: Object.keys(banner).length > 0 ? banner : null } } });
          toast.success(t('common.saved'));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('settings.saveError'));
        }
      }}
    />
  );
}

/** The shared banner field set (enable toggle, message, link, dismissible) with
 *  the section's single SaveBar — one instance per active scope. */
function BannerScopeForm({
  initial,
  onSave,
  placeholders,
  onDirtyChange,
}: {
  initial: BannerValues;
  onSave: (value: BannerValues) => Promise<void>;
  placeholders?: { message?: string; linkLabel?: string; linkUrl?: string };
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const [enabled, setEnabled] = useState<boolean>(initial.enabled);
  const [dismissible, setDismissible] = useState<boolean>(initial.dismissible);
  // The two toggles live outside the form, so their dirtiness is tracked by value.
  const togglesDirty = enabled !== initial.enabled || dismissible !== initial.dismissible;

  const form = useForm({
    defaultValues: {
      message: initial.message,
      linkLabel: initial.linkLabel,
      linkUrl: initial.linkUrl,
    },
    onSubmit: async ({ value }) => {
      await onSave({ ...value, enabled, dismissible });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <ToggleRow checked={enabled} hint={t('settings.banner.enable.hint')} onCheckedChange={setEnabled} title={t('settings.banner.enable.title')} />

      <div className="mt-5">
        <form.Field name="message">
          {(field) => (
            <Field hint={t('settings.banner.message.hint')} label={t('settings.banner.message.label')}>
              <Input
                className={FIELD_INPUT}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={placeholders?.message ?? t('settings.banner.message.placeholder')}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="linkLabel">
          {(field) => (
            <Field hint={t('settings.banner.linkLabel.hint')} label={t('settings.banner.linkLabel.label')}>
              <Input
                className={FIELD_INPUT}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={placeholders?.linkLabel ?? t('settings.banner.linkLabel.placeholder')}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="linkUrl">
          {(field) => (
            <Field hint={t('settings.banner.linkUrl.hint')} label={t('settings.banner.linkUrl.label')}>
              <Input
                className={FIELD_INPUT}
                type="url"
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={placeholders?.linkUrl ?? t('settings.banner.linkUrl.placeholder')}
                value={field.state.value}
              />
            </Field>
          )}
        </form.Field>
      </div>

      <ToggleRow
        checked={dismissible}
        hint={t('settings.banner.dismissible.hint')}
        onCheckedChange={setDismissible}
        title={t('settings.banner.dismissible.title')}
      />

      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <DirtyStateReporter dirty={isDirty || togglesDirty} onDirtyChange={onDirtyChange} />}
      </form.Subscribe>

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
