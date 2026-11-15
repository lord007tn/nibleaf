import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useT } from '@nibleaf/i18n/react';
import { SearchCheck, Upload } from 'lucide-react';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { LanguageScopePicker, SectionHeader, sortLanguagesDefaultFirst, useScopeDirtyGuard } from '@/components/project-settings/shared';
import { FormField, type FormFieldControl } from '@/components/ui/form-field';
import type { Language, Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveSeo, useSeoLanguages, useUploadSocialImage } from '../api/hooks';
import { PROJECT_SCOPE, type SeoValues, seoPlaceholders, seoValues, type UploadRequest, uploadResultAction } from '../model/seo';

/** The `dir` for text written in a content language; the project scope lets the text decide. */
const dirOf = (language: Pick<Language, 'direction'> | undefined) => (language ? (language.direction === 'RTL' ? 'rtl' : 'ltr') : 'auto');

/**
 * Site configuration → SEO, in the editor's Configuration tab and Settings →
 * Appearance. One explicit-save form edits the active scope: "Default" edits
 * the project's SEO, a language scope that language's override. An upload
 * fills the social image in the draft; only Save stores it.
 */
export function SeoSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <SeoForm project={project} />
    </SaveRegionProvider>
  );
}

function SeoForm({ project }: { project: Project }) {
  const t = useT();
  const { data: languages } = useSeoLanguages(project.id);
  const { saveProject, saveLanguage } = useSaveSeo(project.id);
  const ordered = sortLanguagesDefaultFirst(languages ?? []);
  const defaultLanguage = ordered.find((language) => language.isDefault);
  const extraLanguages = ordered.filter((language) => !language.isDefault);
  const [scope, setScope] = useState<string>(PROJECT_SCOPE);
  const activeLanguage = extraLanguages.find((language) => language.id === scope);
  const projectSeo = project.config?.seo;
  const languageSeo = activeLanguage?.config?.seo;
  const source = useMemo(() => seoValues(activeLanguage ? languageSeo : projectSeo), [activeLanguage, languageSeo, projectSeo]);
  const identity = [project.id, 'seo', activeLanguage?.id ?? PROJECT_SCOPE];

  const { form, ...draft } = useServerDraftForm<SeoValues>({
    identity,
    source,
    onSubmit: async (value, save) => {
      try {
        save.succeeded(activeLanguage ? await saveLanguage(activeLanguage.id, value) : await saveProject(value));
        return 'saved';
      } catch (error) {
        save.failed();
        // A save for a scope or site this form has since left says nothing here.
        if (save.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });

  const uploadImage = useUploadSocialImage(project.id);
  const uploads = useSocialImageUpload({
    draftKey: JSON.stringify(identity),
    upload: uploadImage,
    read: () => form.getFieldValue('socialImage'),
    fill: (url) => form.setFieldValue('socialImage', url),
  });

  const { submit: submitDraft, discard: discardDraft, isSaving } = draft;
  // The page's save bar disables Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    const outcome = await submitDraft();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [submitDraft]);
  const { forget } = uploads;
  // Discarding throws away the draft, an upload in flight included: its file stays in the site's files.
  const discard = useCallback(() => {
    if (isSaving) return;
    discardDraft();
    forget();
  }, [discardDraft, forget, isSaving]);
  // Enter in a single-line field saves this form through the bar's own run; the description keeps its newline.
  const formProps = useSaveRegionForm('site-seo', { isDirty: draft.isDirty, isSubmitting: isSaving, submit, discard });

  // Switching scope asks first while there are edits, or a save that can still change them.
  const { guard, setDirty } = useScopeDirtyGuard();
  const unsettled = draft.isDirty || isSaving;
  useLayoutEffect(() => setDirty(unsettled), [setDirty, unsettled]);

  const placeholders = seoPlaceholders(activeLanguage ? 'language' : 'project', projectSeo, project);
  const textDir = dirOf(activeLanguage);

  return (
    <form noValidate {...formProps}>
      <SaveRegionSubmit />
      <SectionHeader icon={<SearchCheck className="size-4" />} title={t('settings.seo.title')} />
      <LanguageScopePicker
        defaultLanguage={defaultLanguage}
        guard={guard}
        hint={t('settings.seo.scope.hint')}
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

      <SettingsSection>
        <form.Field name="metaTitle">
          {(field) => (
            <FormField<string>
              description={t('settings.seo.metaTitle.hint')}
              field={field}
              label={t('settings.seo.metaTitle.label')}
              layout="stacked"
            >
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  dir={textDir}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder={placeholders.metaTitle}
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="metaDescription">
          {(field) => (
            <FormField<string>
              description={t('settings.seo.metaDescription.hint')}
              field={field}
              label={t('settings.seo.metaDescription.label')}
              layout="stacked"
            >
              {({ controlProps, value, onValueChange }) => (
                <Textarea
                  {...controlProps}
                  className="min-h-21"
                  dir={textDir}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder={placeholders.metaDescription}
                  value={value}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="socialImage">
          {(field) => (
            <FormField<string>
              description={t('settings.seo.socialImage.hint')}
              field={field}
              label={t('settings.seo.socialImage.label')}
              layout="stacked"
            >
              {(control) => (
                <SocialImageControl
                  control={{
                    ...control,
                    onValueChange: (next) => {
                      uploads.edited();
                      control.onValueChange(next);
                    },
                  }}
                  onFile={(file) => void uploads.start(file)}
                  placeholder={placeholders.socialImage}
                  uploading={uploads.pending}
                />
              )}
            </FormField>
          )}
        </form.Field>
        <form.Field name="allowIndex">
          {(field) => (
            <FormField<boolean>
              control="switch"
              description={t('settings.seo.allowIndex.hint')}
              field={field}
              label={t('settings.seo.allowIndex.title')}
            >
              {({ controlProps, value, onValueChange, ids }) => (
                <Switch {...controlProps} aria-labelledby={ids.labelId} checked={value} onCheckedChange={onValueChange} />
              )}
            </FormField>
          )}
        </form.Field>
      </SettingsSection>
    </form>
  );
}

/** The social image's path or URL (Latin, left to right in every locale) with an Upload button. */
function SocialImageControl({
  control: { controlProps, ids, value, onValueChange },
  placeholder,
  uploading,
  onFile,
}: {
  control: FormFieldControl<string>;
  placeholder: string | undefined;
  uploading: boolean;
  onFile: (file: File) => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const buttonId = useId();
  return (
    <div className="flex gap-2.5">
      <Input
        {...controlProps}
        autoCapitalize="off"
        autoComplete="off"
        className="min-w-0 flex-1 font-mono text-sm"
        dir="ltr"
        inputMode="url"
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        value={value}
      />
      <input
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) onFile(file);
        }}
        ref={fileRef}
        tabIndex={-1}
        type="file"
      />
      {/* Named "Upload <field>", as the field's own label says what it uploads. */}
      <Button
        aria-labelledby={`${buttonId} ${ids.labelId}`}
        id={buttonId}
        loading={uploading}
        onClick={() => fileRef.current?.click()}
        type="button"
        variant="outline"
      >
        <Upload aria-hidden className="size-4" /> {t('settings.seo.upload')}
      </Button>
    </div>
  );
}

/**
 * The social-image upload this form started, owned by the draft it was
 * started in (operations/ui-overhaul.md §8.3, applied to uploads), as in
 * Branding.
 *
 * One upload at a time: while it runs the button shows progress. Its result
 * fills the field only while the draft it started in is still here (no
 * discard, same site and scope, even after leaving and coming back) and the
 * field hasn't been edited or changed since (`uploadResultAction`). A failure
 * leaves the field as it is and says so once. Nothing here saves.
 */
function useSocialImageUpload({
  draftKey,
  upload,
  read,
  fill,
}: {
  draftKey: string;
  upload: (file: File) => Promise<string>;
  read: () => string;
  fill: (url: string) => void;
}) {
  const t = useT();
  // Bumped on discard and whenever the form leaves this site or scope (another one, or unmount).
  const draftRef = useRef(0);
  // Bumped on every edit to the field, so typing a value back still counts as an edit.
  const editsRef = useRef(0);
  const inFlight = useRef<UploadRequest | null>(null);
  const [pending, setPending] = useState(false);

  const forget = useCallback(() => {
    draftRef.current += 1;
    inFlight.current = null;
    setPending(false);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: leaving a site or scope (for another, or on unmount) forgets its upload, even on a return to it (A → B → A).
  useEffect(() => forget, [forget, draftKey]);

  const edited = useCallback(() => {
    editsRef.current += 1;
  }, []);

  const start = async (file: File) => {
    if (inFlight.current) return;
    const request: UploadRequest = { draft: draftRef.current, edits: editsRef.current, startedFrom: read() };
    inFlight.current = request;
    setPending(true);
    let url: string | undefined;
    let failure: unknown;
    try {
      url = await upload(file);
    } catch (error) {
      failure = error;
    }
    if (inFlight.current === request) {
      inFlight.current = null;
      setPending(false);
    }
    const action = uploadResultAction(request, { draft: draftRef.current, edits: editsRef.current, value: read() });
    if (action === 'stale') return;
    if (url === undefined) {
      toast.error(friendlyErrorMessage(t, failure, 'settings.seo.uploadError'));
      return;
    }
    if (action === 'apply') {
      fill(url);
      toast.success(t('settings.seo.uploaded'));
    }
  };

  return { pending, start, forget, edited };
}
