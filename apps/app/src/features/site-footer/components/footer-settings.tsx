import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { useT } from '@nibleaf/i18n/react';
import { PanelBottom } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  FIELD_INPUT,
  FIELD_MONO,
  Field,
  LanguageScopePicker,
  SectionHeader,
  sortLanguagesDefaultFirst,
  ToggleRow,
  useScopeDirtyGuard,
} from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useFooterLanguages, useSaveFooter } from '../api/hooks';
import {
  type FooterConfig,
  type FooterValues,
  footerValues,
  knownStoredFooter,
  languageFooterValues,
  PROJECT_SCOPE,
  sentFooterValues,
} from '../model/footer';

/** The social links: addresses, read left to right in every locale. */
const SOCIAL = [
  { name: 'github', placeholder: 'https://github.com/acme' },
  { name: 'x', placeholder: 'https://x.com/acme' },
  { name: 'linkedin', placeholder: 'https://linkedin.com/company/acme' },
] as const;

/** Props for an address field: no autocorrect, left to right. */
const URL_INPUT = { autoCapitalize: 'off', autoComplete: 'off', className: FIELD_MONO, dir: 'ltr', inputMode: 'url', spellCheck: false } as const;

/**
 * Site configuration → Footer, in the editor's Configuration tab. One
 * explicit-save form edits the active scope: "Default" edits the project
 * footer; a language scope localizes the copyright line only, and shows the
 * global social links and badge read-only.
 */
export function FooterSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <FooterForm project={project} />
    </SaveRegionProvider>
  );
}

function FooterForm({ project }: { project: Project }) {
  const t = useT();
  const { data: languages } = useFooterLanguages(project.id);
  const { saveProject, saveLanguage } = useSaveFooter(project.id);
  const ordered = sortLanguagesDefaultFirst(languages ?? []);
  const defaultLanguage = ordered.find((language) => language.isDefault);
  const extraLanguages = ordered.filter((language) => !language.isDefault);
  const [scope, setScope] = useState<string>(PROJECT_SCOPE);
  const activeLanguage = extraLanguages.find((language) => language.id === scope);
  const projectFooter = project.config?.footer;
  const override = activeLanguage?.config?.footer;
  const source = useMemo(
    () => (activeLanguage ? languageFooterValues(override, projectFooter) : footerValues(projectFooter)),
    [activeLanguage, override, projectFooter],
  );
  const scopeKind = activeLanguage ? 'language' : 'project';
  const identity = [project.id, 'footer', activeLanguage?.id ?? PROJECT_SCOPE];
  const identityKey = JSON.stringify(identity);

  // The project footer a successful save of this draft showed stored, so a
  // failed refetch can't hide a text the server now holds. It belongs to this
  // draft: forgotten on any change of site or scope (A → B → A included), and a
  // save that has left its draft never records one.
  const confirmedStored = useRef<FooterConfig | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new site or scope starts from what the project query says.
  useLayoutEffect(() => {
    confirmedStored.current = undefined;
  }, [identityKey]);
  const stored = () => knownStoredFooter(projectFooter, confirmedStored.current);

  const { form, ...draft } = useServerDraftForm<FooterValues>({
    identity,
    source,
    // The save sends trimmed text (and, from a language, the copyright only); judge its echo by that.
    toSent: (value) => sentFooterValues(scopeKind, value, stored()),
    // `succeeded()` says whether the draft settled clean. Footer has nothing to
    // close or collapse: an unclean save (an edit made meanwhile, or a conflict)
    // stays on screen, dirty, with its conflict to resolve.
    onSubmit: async (value, save) => {
      try {
        if (activeLanguage) {
          save.succeeded(await saveLanguage(activeLanguage.id, value, projectFooter));
        } else {
          const result = await saveProject(value, stored());
          if (save.isCurrent()) confirmedStored.current = knownStoredFooter(result.stored, confirmedStored.current);
          save.succeeded(result.values);
        }
        return 'saved';
      } catch (error) {
        save.failed();
        // A save for a scope or site this form has since left says nothing here.
        if (save.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });

  const { submit: submitDraft } = draft;
  // The page's save bar disables Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    const outcome = await submitDraft();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [submitDraft]);
  // Enter in a single-line field saves this form through the bar's own run: same lock, status and focus.
  const formProps = useSaveRegionForm('site-footer', { isDirty: draft.isDirty, isSubmitting: draft.isSaving, submit, discard: draft.discard });

  // Switching scope asks first while there are edits, or a save that can still change them.
  const { guard, setDirty } = useScopeDirtyGuard();
  const unsettled = draft.isDirty || draft.isSaving;
  useLayoutEffect(() => setDirty(unsettled), [setDirty, unsettled]);

  return (
    <form noValidate {...formProps}>
      <SaveRegionSubmit />
      <SectionHeader icon={<PanelBottom className="size-4" />} title={t('settings.footer.title')} />
      <LanguageScopePicker
        defaultLanguage={defaultLanguage}
        guard={guard}
        hint={t('settings.footer.scope.hint')}
        languages={extraLanguages}
        onChange={setScope}
        value={scope}
      />

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
          className="mb-4"
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}

      <form.Field name="copyright">
        {(field) => (
          <Field hint={t('settings.footer.copyright.hint')} label={t('settings.footer.copyright.label')}>
            {/* The project's line lets its text decide; a language's is written in that language. */}
            <Input
              className={FIELD_INPUT}
              dir={activeLanguage ? (activeLanguage.direction === 'RTL' ? 'rtl' : 'ltr') : 'auto'}
              lang={activeLanguage?.code}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder={(activeLanguage && projectFooter?.copyright) || t('settings.footer.copyright.placeholder')}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      {activeLanguage ? (
        // Global fields: shown so the scope reads as the whole footer, read-only, and saying why.
        <>
          {SOCIAL.map(({ name, placeholder }) => (
            <Field hint={t('settings.chrome.scope.globalField')} key={name} label={t(`settings.footer.${name}.label`)}>
              <Input {...URL_INPUT} disabled placeholder={placeholder} value={projectFooter?.[name] ?? ''} />
            </Field>
          ))}
          <ToggleRow
            checked={projectFooter?.madeWithBadge !== false}
            disabled
            hint={t('settings.chrome.scope.globalField')}
            title={t('settings.footer.badge.title')}
          />
        </>
      ) : (
        <>
          {SOCIAL.map(({ name, placeholder }) => (
            <form.Field key={name} name={name}>
              {(field) => (
                <Field hint={t(`settings.footer.${name}.hint`)} label={t(`settings.footer.${name}.label`)}>
                  <Input
                    {...URL_INPUT}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={placeholder}
                    value={field.state.value}
                  />
                </Field>
              )}
            </form.Field>
          ))}
          <form.Field name="madeWithBadge">
            {(field) => (
              <ToggleRow
                checked={field.state.value}
                hint={t('settings.footer.badge.hint')}
                onCheckedChange={field.handleChange}
                title={t('settings.footer.badge.title')}
              />
            )}
          </form.Field>
        </>
      )}
    </form>
  );
}
