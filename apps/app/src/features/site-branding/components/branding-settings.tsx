import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Upload } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useSectionScope } from '@/components/project-settings/shared';
import { FormField, type FormFieldControl } from '@/components/ui/form-field';
import type { Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveBranding, useUploadBrandingImage } from '../api/hooks';
import { type BrandingValues, brandingValues, type UploadField, type UploadRequest, uploadResultAction } from '../model/branding';

const UPLOAD_ROWS = [
  { field: 'logoLight', label: 'settings.branding.logoLight.label', hint: 'settings.branding.logoLight.hint', placeholder: '/logo/light.svg' },
  { field: 'logoDark', label: 'settings.branding.logoDark.label', hint: 'settings.branding.logoDark.hint', placeholder: '/logo/dark.svg' },
  { field: 'favicon', label: 'settings.branding.favicon.label', hint: 'settings.branding.favicon.hint', placeholder: '/favicon.svg' },
] as const satisfies ReadonlyArray<{ field: UploadField; label: MessageKey; hint: MessageKey; placeholder: string }>;

const LABELS = Object.fromEntries(UPLOAD_ROWS.map(({ field, label }) => [field, label])) as Record<UploadField, MessageKey>;

/** Paths and URLs are Latin and read left to right in every locale. */
const locationProps = {
  autoCapitalize: 'off',
  autoComplete: 'off',
  className: 'font-mono text-sm',
  dir: 'ltr',
  inputMode: 'url',
  spellCheck: false,
} as const;

/**
 * Site configuration → Branding, in the editor's Configuration tab: the two
 * logos, the favicon and where the logo links to, in one explicit-save form.
 * An upload fills its field in the draft; only Save stores it.
 */
export function BrandingSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <BrandingForm project={project} />
    </SaveRegionProvider>
  );
}

function BrandingForm({ project }: { project: Project }) {
  const t = useT();
  const { save } = useSaveBranding(project.id);
  const source = useMemo(() => brandingValues(project.config), [project.config]);

  const { form, ...draft } = useServerDraftForm<BrandingValues>({
    identity: [project.id, 'branding'],
    source,
    onSubmit: async (value, outcome) => {
      try {
        outcome.succeeded(await save(outcome.baseline, value));
        return 'saved';
      } catch (error) {
        outcome.failed();
        // A save for a site this form no longer shows says nothing.
        if (outcome.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });

  const scope = useSectionScope();
  const uploadImage = useUploadBrandingImage(project.id);
  const uploads = useBrandingUploads({
    siteId: project.id,
    upload: uploadImage,
    read: (field) => form.getFieldValue(field),
    fill: (field, url) => form.setFieldValue(field, url),
  });

  const { submit: submitDraft, discard: discardDraft, isSaving } = draft;
  // The page's save bar disables Save while saving, so 'busy' only means "nothing new to report".
  const submit = useCallback(async () => {
    const outcome = await submitDraft();
    return outcome === 'busy' ? 'failed' : outcome;
  }, [submitDraft]);
  const { forget } = uploads;
  // Discarding throws away the draft, uploads still in flight included: their
  // files stay in the site's files but never reach the form.
  const discard = useCallback(() => {
    if (isSaving) return;
    discardDraft();
    forget();
  }, [discardDraft, forget, isSaving]);
  // Enter in a path or URL field saves this form through the bar's own run (only while dirty).
  const formProps = useSaveRegionForm('site-branding', {
    isDirty: draft.isDirty,
    isSubmitting: isSaving,
    submit,
    discard,
    settlement: draft.settlement,
  });

  return (
    <form className="flex flex-col gap-6" noValidate {...formProps}>
      <SaveRegionSubmit />
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

      <SettingsSection {...scope} title={t('settings.branding.title')}>
        {UPLOAD_ROWS.map(({ field: name, label, hint, placeholder }) => (
          <form.Field key={name} name={name}>
            {(field) => (
              <FormField<string> description={t(hint)} field={field} label={t(label)} layout="stacked">
                {(control) => (
                  <UploadControl
                    control={control}
                    onFile={(file) => void uploads.start(name, file)}
                    placeholder={placeholder}
                    uploading={uploads.pending.includes(name)}
                  />
                )}
              </FormField>
            )}
          </form.Field>
        ))}
        <form.Field name="logoHref">
          {(field) => (
            <FormField<string>
              control="field"
              description={t('settings.branding.logoHref.hint')}
              field={field}
              label={t('settings.branding.logoHref.label')}
            >
              {({ controlProps, value, onValueChange }) => (
                <Input
                  {...controlProps}
                  {...locationProps}
                  onChange={(event) => onValueChange(event.target.value)}
                  placeholder="https://example.com"
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

/** A path or URL field with an Upload button that picks an image to fill it. */
function UploadControl({
  control: { controlProps, ids, value, onValueChange },
  placeholder,
  uploading,
  onFile,
}: {
  control: FormFieldControl<string>;
  placeholder: string;
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
        {...locationProps}
        className={`${locationProps.className} min-w-0 flex-1`}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder={placeholder}
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
      {/* Named "Upload <field>", so the three buttons are told apart. */}
      <Button
        aria-labelledby={`${buttonId} ${ids.labelId}`}
        id={buttonId}
        loading={uploading}
        onClick={() => fileRef.current?.click()}
        type="button"
        variant="outline"
      >
        <Upload aria-hidden className="size-4" /> {t('settings.branding.upload')}
      </Button>
    </div>
  );
}

/**
 * The uploads this form started, each owned by the draft it was started in
 * (operations/ui-overhaul.md §8.3, applied to uploads).
 *
 * Concurrency: at most one upload per field. While a field's upload runs its
 * button shows progress and can't start another; the other fields' buttons
 * stay usable, so up to three uploads overlap. A result fills only its own
 * field, and only while the draft it started in is still here and the field
 * still holds the value it had then (`uploadResultAction`): a later edit, a
 * clear, a server update, a discard or another site wins over it. A failure
 * leaves the field as it is and says so once, naming the field. Nothing here
 * saves the configuration.
 */
function useBrandingUploads({
  siteId,
  upload,
  read,
  fill,
}: {
  siteId: string;
  upload: (file: File) => Promise<string>;
  read: (field: UploadField) => string;
  fill: (field: UploadField, url: string) => void;
}) {
  const t = useT();
  // Bumped on discard and whenever the form leaves this site (another site, or unmount).
  const draftRef = useRef(0);
  const inFlight = useRef(new Map<UploadField, UploadRequest>());
  const [pending, setPending] = useState<UploadField[]>([]);
  const publish = useCallback(() => setPending([...inFlight.current.keys()]), []);

  const forget = useCallback(() => {
    draftRef.current += 1;
    inFlight.current.clear();
    publish();
  }, [publish]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: leaving a site (for another, or on unmount) forgets its uploads, even on a return to it (A → B → A).
  useEffect(() => forget, [forget, siteId]);

  const start = async (field: UploadField, file: File) => {
    if (inFlight.current.has(field)) return;
    const request: UploadRequest = { field, draft: draftRef.current, startedFrom: read(field) };
    inFlight.current.set(field, request);
    publish();
    let url: string | undefined;
    let failure: unknown;
    try {
      url = await upload(file);
    } catch (error) {
      failure = error;
    }
    if (inFlight.current.get(field) === request) {
      inFlight.current.delete(field);
      publish();
    }
    const action = uploadResultAction(request, { draft: draftRef.current, value: read(field) });
    if (action === 'stale') return;
    if (url === undefined) {
      toast.error(friendlyErrorMessage(t, failure, 'settings.branding.uploadError'), { description: t(LABELS[field]) });
      return;
    }
    if (action === 'apply') {
      fill(field, url);
      toast.success(t('settings.branding.uploaded'), { description: t(LABELS[field]) });
    }
  };

  return { pending, start, forget };
}
