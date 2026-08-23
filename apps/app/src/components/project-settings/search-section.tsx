import { Input } from '@nibleaf/design-system/components/ui/input';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Language, Project } from '@/hooks/api';
import { useLanguages, useProjectSearchConfiguration, useUpdateLanguage, useUpdateProjectSearchConfiguration } from '@/hooks/api';
import { SearchIndexDiagnostics } from './search-index-diagnostics';
import {
  DirtyStateReporter,
  FIELD_INPUT,
  Field,
  LanguageScopePicker,
  SaveBar,
  SectionHeader,
  Segmented,
  sortLanguagesDefaultFirst,
  ToggleRow,
  useScopeDirtyGuard,
} from './shared';

type Hotkey = 'cmdk' | 'slash';

/** Search with a per-language scope: "Default" edits `project.config.search`
 *  exactly as before; a language scope localizes the placeholder only — the
 *  hotkey and result limit stay global. */
export function SearchSection({ project }: { project: Project }) {
  const t = useT();
  const { data: languages } = useLanguages(project.id);
  const orderedLanguages = sortLanguagesDefaultFirst(languages ?? []);
  const defaultLanguage = orderedLanguages.find((language) => language.isDefault);
  const extraLanguages = orderedLanguages.filter((language) => !language.isDefault);
  const [scope, setScope] = useState<string>('default');
  const activeLanguage = extraLanguages.find((language) => language.id === scope);
  const { guard, setDirty } = useScopeDirtyGuard();

  return (
    <div>
      <SectionHeader icon={<Search className="size-4" />} title={t('settings.search.title')} />
      <LanguageScopePicker
        defaultLanguage={defaultLanguage}
        guard={guard}
        hint={t('settings.search.scope.hint')}
        languages={extraLanguages}
        onChange={setScope}
        value={scope}
      />
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
  const configuration = useProjectSearchConfiguration(project.id);
  if (configuration.isPending) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }
  if (configuration.isError || !configuration.data) {
    return <SearchConfigurationError onRetry={() => void configuration.refetch()} />;
  }
  return (
    <>
      <ProjectSearchConfigurationForm
        key={JSON.stringify(configuration.data.configuration)}
        configuration={configuration.data.configuration}
        maxResultsConstraint={configuration.data.constraints.maxResults}
        onDirtyChange={onDirtyChange}
        projectId={project.id}
      />
      <SearchIndexDiagnostics projectId={project.id} />
    </>
  );
}

function SearchConfigurationError({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
      <p className="font-medium text-destructive">{t('settings.search.configuration.error')}</p>
      <button className="mt-2 font-medium text-primary text-xs hover:underline" onClick={onRetry} type="button">
        {t('common.retry')}
      </button>
    </div>
  );
}

function ProjectSearchConfigurationForm({
  projectId,
  configuration,
  maxResultsConstraint,
  onDirtyChange,
}: {
  projectId: string;
  configuration: {
    maxResults: number;
    filtersEnabled: boolean;
    versionFilterEnabled: boolean;
    aiAnswers: boolean;
    hotkey: Hotkey;
    placeholder: string | null;
  };
  maxResultsConstraint: { default: number; min: number; max: number };
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const update = useUpdateProjectSearchConfiguration(projectId);
  const [hotkey, setHotkey] = useState<Hotkey>(configuration.hotkey);
  const [aiAnswers, setAiAnswers] = useState(configuration.aiAnswers ? 'enabled' : 'disabled');
  const [filtersEnabled, setFiltersEnabled] = useState(configuration.filtersEnabled);
  const [versionFilterEnabled, setVersionFilterEnabled] = useState(configuration.versionFilterEnabled);
  // The hotkey control lives outside the form, so its dirtiness is tracked by value.
  const controlsDirty =
    hotkey !== configuration.hotkey ||
    (aiAnswers === 'enabled') !== configuration.aiAnswers ||
    filtersEnabled !== configuration.filtersEnabled ||
    versionFilterEnabled !== configuration.versionFilterEnabled;

  const form = useForm({
    defaultValues: { placeholder: configuration.placeholder ?? '', maxResults: String(configuration.maxResults) },
    onSubmit: async ({ value }) => {
      const parsedMaxResults = Number.parseInt(value.maxResults, 10);
      try {
        await update.mutateAsync({
          hotkey,
          placeholder: value.placeholder.trim() || null,
          maxResults: Number.isFinite(parsedMaxResults)
            ? Math.min(maxResultsConstraint.max, Math.max(maxResultsConstraint.min, parsedMaxResults))
            : maxResultsConstraint.default,
          filtersEnabled,
          versionFilterEnabled,
          aiAnswers: aiAnswers === 'enabled',
        });
        toast.success(t('common.saved'));
      } catch {
        toast.error(t('settings.search.configuration.error'));
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
              max={maxResultsConstraint.max}
              min={maxResultsConstraint.min}
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

      <div className="mb-6 rounded-lg border px-4">
        <ToggleRow
          checked={filtersEnabled}
          hint={t('settings.search.filters.hint')}
          onCheckedChange={setFiltersEnabled}
          title={t('settings.search.filters.label')}
        />
        <ToggleRow
          checked={versionFilterEnabled}
          hint={t('settings.search.versionFilters.hint')}
          onCheckedChange={setVersionFilterEnabled}
          title={t('settings.search.versionFilters.label')}
        />
      </div>

      <Field hint={t('settings.search.aiAnswers.hint')} label={t('settings.search.aiAnswers.label')}>
        <Segmented
          className="max-w-[240px]"
          onChange={setAiAnswers}
          options={[
            { value: 'enabled', label: t('settings.search.aiAnswers.enabled') },
            { value: 'disabled', label: t('settings.search.aiAnswers.disabled') },
          ]}
          value={aiAnswers}
        />
      </Field>

      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <DirtyStateReporter dirty={isDirty || controlsDirty} onDirtyChange={onDirtyChange} />}
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
  const projectSearch = project.config?.search ?? {};

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
              placeholder={projectSearch.placeholder || t('settings.search.placeholder.input')}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      {/* Global-only fields: visible but disabled so the language scope still
          reads as the complete search form. */}
      <Field hint={t('settings.chrome.scope.globalField')} label={t('settings.search.maxResults.label')}>
        <Input className={FIELD_INPUT} disabled type="number" value={String(projectSearch.maxResults ?? 12)} />
      </Field>
      <Field hint={t('settings.chrome.scope.globalField')} label={t('settings.search.hotkey.label')}>
        <Segmented
          className="max-w-[200px] font-mono"
          disabled
          onChange={() => undefined}
          options={[
            { value: 'cmdk', label: '⌘K' },
            { value: 'slash', label: '/' },
          ]}
          value={(projectSearch.hotkey as Hotkey) ?? 'cmdk'}
        />
      </Field>

      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <DirtyStateReporter dirty={isDirty} onDirtyChange={onDirtyChange} />}
      </form.Subscribe>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
