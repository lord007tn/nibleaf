import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { LanguageOptionLabel, SettingsFormSkeleton } from '@/components/project-settings/shared';
import { QueryErrorState } from '@/components/query-error-state';
import { FormField } from '@/components/ui/form-field';
import type { Language, Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { isolate } from '@/lib/bidi';
import { validateOnBlurThenChange } from '@/lib/forms/field-errors';
import { focusFirstInvalid, SaveRegionProvider, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { groundedAnswersState } from '@/lib/grounded-answers';
import type { SiteAdminState } from '@/lib/project-settings-access';
import { useSaveSearch, useSearchAi, useSearchConfiguration, useSearchLanguages, wasReported } from '../api/hooks';
import {
  aiAnswersControl,
  decisionProps,
  fieldsDecision,
  HOTKEY_LABEL,
  type MaxResultsRange,
  maxResultsProblem,
  normalizeSearch,
  orderLanguages,
  readOnlyNote,
  SEARCH_HOTKEYS,
  SEARCH_PLACEHOLDER_MAX,
  type SearchConfigurationLike,
  type SearchHotkey,
  type SearchValues,
  searchValues,
  startersProblem,
  supportUrlProblem,
} from '../model/search';
import { IndexHealthSection } from './index-health';

const NO_LANGUAGES: Language[] = [];

/** The `dir` for text written in a content language, independent of the interface locale. */
const dirOf = (language: Pick<Language, 'direction'> | undefined) => (language ? (language.direction === 'RTL' ? 'rtl' : 'ltr') : 'auto');

/**
 * Site settings → Search. One explicit-save form for the search box (its
 * placeholder, per language too, hotkey, result limit and version filter) and
 * the AI assistant (grounded answers, saved questions, suggested questions and
 * the support link), then the index's health with Reindex.
 */
export function SearchSettings({ project }: { project: Project }) {
  const t = useT();
  const configuration = useSearchConfiguration(project.id);
  const languages = useSearchLanguages(project.id);
  const access = useProjectAdminStatus(project.id);
  if (configuration.isPending || languages.isPending) return <SettingsFormSkeleton />;
  const note = readOnlyNote(access.status);
  return (
    <SaveRegionProvider>
      <div className="me-auto flex w-full max-w-[47.5rem] flex-col gap-8">
        <PageHeader description={t('settings.search.summary')} title={t('settings.search.title')} />
        {note ? (
          <Callout role="note" title={t('settings.permissions.title')} tone="info">
            {t(note)}
          </Callout>
        ) : null}
        {configuration.data ? (
          // A failed language list still lets the site-wide settings be edited; per-language placeholders need it.
          <SearchForm
            configuration={configuration.data.configuration}
            languages={languages.data ?? NO_LANGUAGES}
            project={project}
            range={configuration.data.constraints.maxResults}
            status={access.status}
          />
        ) : (
          <QueryErrorState
            description={t('settings.search.configuration.error')}
            onRetry={() => void configuration.refetch()}
            retrying={configuration.isFetching}
          />
        )}
        <IndexHealthSection projectId={project.id} status={access.status} />
      </div>
    </SaveRegionProvider>
  );
}

function SearchForm({
  project,
  configuration,
  range,
  languages,
  status,
}: {
  project: Project;
  configuration: SearchConfigurationLike;
  range: MaxResultsRange;
  languages: Language[];
  status: SiteAdminState;
}) {
  const t = useT();
  const { save } = useSaveSearch(project.id);
  const extraLanguages = orderLanguages(languages).filter((language) => !language.isDefault);
  const source = useMemo(() => searchValues(configuration, languages), [configuration, languages]);
  const formRef = useRef<HTMLFormElement>(null);

  const { form, ...draft } = useServerDraftForm<SearchValues>({
    identity: [project.id, 'search'],
    source,
    onSubmit: async (value, outcome) => {
      try {
        await save(outcome.baseline, value);
        outcome.succeeded(normalizeSearch(value));
        return 'saved';
      } catch (error) {
        outcome.failed();
        // A configuration failure was already toasted by its mutation; a save for a site this form no longer shows says nothing.
        if (outcome.isCurrent() && !wasReported(error)) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });
  const sitePlaceholder = useStore(form.store, (state) => state.values.placeholder);

  const { submit: submitDraft } = draft;
  // The page's save bar disables Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    const outcome = await submitDraft();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [submitDraft]);
  useSaveRegionForm('site-search', { isDirty: draft.isDirty, isSubmitting: draft.isSaving, submit, discard: draft.discard });

  const { disabled } = decisionProps(fieldsDecision(status));
  const answersState = groundedAnswersState(useSearchAi(project.id).data);
  const answers = aiAnswersControl(answersState, draft.baseline.aiAnswers, status);
  const answersProps = decisionProps(answers.decision);
  const smartAiLink = answers.linkToSmartAi ? (
    <Link
      className="font-medium text-primary underline-offset-4 hover:underline"
      params={{ projectId: project.id }}
      search={{ section: 'smartAi' }}
      to="/app/projects/$projectId/settings"
    >
      {t('settings.search.aiAnswers.openSmartAi')}
    </Link>
  ) : null;
  const withLink = (text: string): ReactNode =>
    smartAiLink ? (
      <>
        {`${text} `}
        {smartAiLink}
      </>
    ) : (
      text
    );

  const maxResultsMessage = (value: string) =>
    maxResultsProblem(value, range) ? t('settings.search.maxResults.error', { min: range.min, max: range.max }) : undefined;
  const startersMessage = (value: string) => (startersProblem(value) ? t('dashboard.ai.startersError') : undefined);
  const supportMessage = (value: string) => (supportUrlProblem(value) ? t('dashboard.ai.supportUrlError') : undefined);
  const hotkeyOptions = SEARCH_HOTKEYS.map((value) => ({ value, label: HOTKEY_LABEL[value] }));

  return (
    <form
      className="flex flex-col gap-8"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.isDirty) return;
        void submit().then((outcome) => outcome === 'invalid' && focusFirstInvalid(formRef.current));
      }}
      ref={formRef}
    >
      {draft.conflicts.length > 0 ? (
        <Callout
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  for (const key of draft.conflicts) draft.resolveConflict(key, 'theirs');
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t('forms.useTheirs')}
              </Button>
              <Button
                onClick={() => {
                  for (const key of draft.conflicts) draft.resolveConflict(key, 'mine');
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('forms.keepMine')}
              </Button>
            </div>
          }
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}

      <SettingsSection title={t('settings.search.box.title')}>
        <form.Field name="placeholder">
          {(field) => (
            <FormField<string>
              control="field"
              description={t('settings.search.placeholder.hint')}
              field={field}
              label={t('settings.search.placeholder.label')}
            >
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  dir="auto"
                  disabled={disabled}
                  maxLength={SEARCH_PLACEHOLDER_MAX}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder={t('settings.search.placeholder.input')}
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        {extraLanguages.map((language) => (
          <form.Field key={language.id} name={`languagePlaceholders.${language.id}`}>
            {(field) => (
              <FormField<string>
                control="field"
                field={field}
                label={
                  <>
                    {t('settings.search.placeholder.label')} · <LanguageOptionLabel language={language} />
                  </>
                }
              >
                {({ controlProps, value, onValueChange }) => (
                  <Input
                    {...controlProps}
                    dir={dirOf(language)}
                    disabled={disabled}
                    lang={language.code}
                    maxLength={SEARCH_PLACEHOLDER_MAX}
                    onChange={(event) => onValueChange(event.target.value)}
                    // Empty uses the site's placeholder, so that is what it shows.
                    placeholder={isolate(sitePlaceholder.trim() || t('settings.search.placeholder.input'))}
                    value={value}
                  />
                )}
              </FormField>
            )}
          </form.Field>
        ))}
        <form.Field name="hotkey">
          {(field) => (
            <FormField<SearchHotkey>
              control="compact"
              description={t('settings.search.hotkey.hint')}
              field={field}
              label={t('settings.search.hotkey.label')}
            >
              {({ controlProps, value, onValueChange, ids }) => (
                <Select
                  disabled={disabled}
                  items={hotkeyOptions}
                  onValueChange={(next) => onValueChange((next as SearchHotkey | null) ?? value)}
                  value={value}
                >
                  <SelectTrigger
                    aria-describedby={controlProps['aria-describedby']}
                    aria-labelledby={ids.labelId}
                    className="w-full font-mono"
                    id={controlProps.id}
                    onBlur={controlProps.onBlur}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {hotkeyOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <span className="font-mono" dir="ltr">
                          {option.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="maxResults" validators={validateOnBlurThenChange(maxResultsMessage)}>
          {(field) => (
            <FormField<string>
              control="compact"
              description={t('settings.search.maxResults.hint')}
              field={field}
              label={t('settings.search.maxResults.label')}
            >
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  disabled={disabled}
                  inputMode="numeric"
                  max={range.max}
                  min={range.min}
                  onChange={(event) => onValueChange(event.target.value)}
                  type="number"
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="versionFilterEnabled">
          {(field) => (
            <FormField<boolean>
              control="switch"
              description={t('settings.search.versionFilters.hint')}
              field={field}
              label={t('settings.search.versionFilters.label')}
            >
              {({ controlProps, value, onValueChange, ids }) => (
                <Switch {...controlProps} aria-labelledby={ids.labelId} checked={value} disabled={disabled} onCheckedChange={onValueChange} />
              )}
            </FormField>
          )}
        </form.Field>
      </SettingsSection>

      <SettingsSection title={t('dashboard.ai.title')}>
        <form.Field name="aiAnswers">
          {(field) => (
            <FormField<boolean>
              control="switch"
              description={
                answers.note ? (
                  <>
                    {t('settings.search.aiAnswers.hint')} {withLink(t(answers.note))}
                  </>
                ) : (
                  t('settings.search.aiAnswers.hint')
                )
              }
              disabledReason={answersProps.reason ? withLink(t(answersProps.reason)) : undefined}
              field={field}
              label={t('settings.search.aiAnswers.label')}
            >
              {({ controlProps, value, onValueChange, ids }) => (
                <Switch
                  {...controlProps}
                  aria-labelledby={ids.labelId}
                  checked={value}
                  disabled={answersProps.disabled}
                  onCheckedChange={onValueChange}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="aiConversationCapture">
          {(field) => (
            <FormField<boolean> control="switch" description={t('dashboard.ai.captureHint')} field={field} label={t('dashboard.ai.capture')}>
              {({ controlProps, value, onValueChange, ids }) => (
                <Switch {...controlProps} aria-labelledby={ids.labelId} checked={value} disabled={disabled} onCheckedChange={onValueChange} />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="aiStarterQuestions" validators={validateOnBlurThenChange(startersMessage)}>
          {(field) => (
            <FormField<string> description={t('dashboard.ai.startersHint')} field={field} label={t('dashboard.ai.starters')} layout="stacked">
              {({ controlProps, value, onValueChange }) => (
                <Textarea
                  {...controlProps}
                  className="min-h-21"
                  dir="auto"
                  disabled={disabled}
                  onChange={(event) => onValueChange(event.target.value)}
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="aiSupportUrl" validators={validateOnBlurThenChange(supportMessage)}>
          {(field) => (
            <FormField<string> control="field" description={t('dashboard.ai.supportUrlHint')} field={field} label={t('dashboard.ai.supportUrl')}>
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  autoComplete="off"
                  dir="ltr"
                  disabled={disabled}
                  inputMode="url"
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder="https://"
                  spellCheck={false}
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
      </SettingsSection>
    </form>
  );
}
