import { Input } from '@nibleaf/design-system/components/ui/input';
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
  Segmented,
  saveConfigSection,
  useScopeDirtyGuard,
} from './shared';

type Hotkey = 'cmdk' | 'slash';

/** Search with a per-language scope: "Default" edits `project.config.search`
 *  exactly as before; a language scope localizes the placeholder only — the
 *  hotkey and result limit stay global. */
export function SearchSection({ project }: { project: Project }) {
  const t = useT();
  const { data: languages } = useLanguages(project.id);
  const extraLanguages = (languages ?? []).filter((language) => !language.isDefault);
  const [scope, setScope] = useState<string>('default');
  const activeLanguage = extraLanguages.find((language) => language.id === scope);
  const { guard, setDirty } = useScopeDirtyGuard();

  return (
    <div>
      <SectionHeader icon="⌕" title={t('settings.search.title')} />
      <LanguageScopePicker guard={guard} hint={t('settings.search.scope.hint')} languages={extraLanguages} onChange={setScope} value={scope} />
      {/* Keyed per scope so switching re-seeds the form from that scope's config. */}
      {activeLanguage ? (
        <LanguageSearchForm key={activeLanguage.id} language={activeLanguage} onDirtyChange={setDirty} project={project} />
      ) : (
        <ProjectSearchForm key="default" onDirtyChange={setDirty} project={project} />
      )}
    </div>
  );
}

/** Default scope: the project-level search config (unchanged). */
function ProjectSearchForm({ project, onDirtyChange }: { project: Project; onDirtyChange?: (dirty: boolean) => void }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const search = project.config?.search ?? {};
  const [hotkey, setHotkey] = useState<Hotkey>((search.hotkey as Hotkey) ?? 'cmdk');
  // The hotkey control lives outside the form, so its dirtiness is tracked by value.
  const hotkeyDirty = hotkey !== ((search.hotkey as Hotkey) ?? 'cmdk');

  const form = useForm({
    defaultValues: { placeholder: search.placeholder ?? '', maxResults: String(search.maxResults ?? 6) },
    onSubmit: async ({ value }) => {
      const parsedMaxResults = Number.parseInt(value.maxResults, 10);
      await saveConfigSection(update, {
        search: {
          hotkey,
          placeholder: value.placeholder.trim() || undefined,
          maxResults: Number.isFinite(parsedMaxResults) ? Math.min(100, Math.max(1, parsedMaxResults)) : 6,
        },
      });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="placeholder">
        {(field) => (
          <Field hint={t('settings.search.placeholder.hint')} label={t('settings.search.placeholder.label')}>
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t('settings.search.placeholder.input')}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="maxResults">
        {(field) => (
          <Field hint={t('settings.search.maxResults.hint')} label={t('settings.search.maxResults.label')}>
            <Input
              className={FIELD_INPUT}
              max={100}
              min={1}
              onChange={(e) => field.handleChange(e.target.value)}
              type="number"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <Field hint={t('settings.search.hotkey.hint')} label={t('settings.search.hotkey.label')}>
        <Segmented
          className="max-w-[200px] font-mono"
          onChange={setHotkey}
          options={[
            { value: 'cmdk', label: '⌘K' },
            { value: 'slash', label: '/' },
          ]}
          value={hotkey}
        />
      </Field>

      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <DirtyStateReporter dirty={isDirty || hotkeyDirty} onDirtyChange={onDirtyChange} />}
      </form.Subscribe>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}

/** A language scope: that language's `config.search` override (placeholder
 *  only), saved via updateLanguage. An empty field clears the override (`null`)
 *  so the language falls back to the project placeholder; the server merge
 *  preserves the language's name/description/seo and other chrome overrides. */
function LanguageSearchForm({
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

  const form = useForm({
    defaultValues: { placeholder: language.config?.search?.placeholder ?? '' },
    onSubmit: async ({ value }) => {
      const placeholder = value.placeholder.trim();
      try {
        await update.mutateAsync({ id: language.id, body: { config: { search: placeholder ? { placeholder } : null } } });
        toast.success(t('common.saved'));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('settings.saveError'));
      }
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="placeholder">
        {(field) => (
          <Field hint={t('settings.search.placeholder.hint')} label={t('settings.search.placeholder.label')}>
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={project.config?.search?.placeholder || t('settings.search.placeholder.input')}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <DirtyStateReporter dirty={isDirty} onDirtyChange={onDirtyChange} />}
      </form.Subscribe>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
