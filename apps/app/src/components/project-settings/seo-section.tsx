import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { SearchCheck, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Language, Project } from '@/hooks/api';
import { useLanguages, useUpdateLanguage, useUpdateProjectConfig, useUploadAsset } from '@/hooks/api';
import {
  DirtyStateReporter,
  FIELD_INPUT,
  FIELD_MONO,
  FIELD_TEXTAREA,
  Field,
  LanguageScopePicker,
  SaveBar,
  SectionHeader,
  saveConfigSection,
  sortLanguagesDefaultFirst,
  ToggleRow,
  useScopeDirtyGuard,
} from './shared';

/** The editable SEO values shared by the project scope and a language scope. */
interface SeoValues {
  metaTitle: string;
  metaDescription: string;
  socialImage: string;
  allowIndex: boolean;
}

/** SEO defaults with a per-language scope: "Default" edits `project.config.seo`
 *  exactly as before; a language scope edits that language's `config.seo`
 *  (layered between the project's SEO and each page's own). */
export function SeoSection({ project }: { project: Project }) {
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
      <SectionHeader icon={<SearchCheck className="size-4" />} title={t('settings.seo.title')} />

      <LanguageScopePicker
        defaultLanguage={defaultLanguage}
        guard={guard}
        hint={t('settings.seo.scope.hint')}
        languages={extraLanguages}
        onChange={setScope}
        value={scope}
      />

      {/* Keyed per scope so switching re-seeds the form from that scope's config. */}
      {activeLanguage ? (
        <LanguageSeoForm key={activeLanguage.id} language={activeLanguage} onDirtyChange={setDirty} project={project} />
      ) : (
        <ProjectSeoForm key="default" onDirtyChange={setDirty} project={project} />
      )}
    </div>
  );
}

/** Default scope: the project-level SEO in `project.config.seo` (unchanged). */
function ProjectSeoForm({ project, onDirtyChange }: { project: Project; onDirtyChange?: (dirty: boolean) => void }) {
  const update = useUpdateProjectConfig(project.id);
  const seo = project.config?.seo ?? {};
  return (
    <SeoScopeForm
      onDirtyChange={onDirtyChange}
      initial={{
        metaTitle: seo.metaTitle ?? '',
        metaDescription: seo.metaDescription ?? '',
        socialImage: seo.socialImage ?? '',
        allowIndex: seo.allowIndex ?? true,
      }}
      onSave={(value) =>
        saveConfigSection(update, {
          seo: {
            metaTitle: value.metaTitle.trim() || undefined,
            metaDescription: value.metaDescription.trim() || undefined,
            socialImage: value.socialImage.trim() || undefined,
            allowIndex: value.allowIndex,
          },
        })
      }
      project={project}
    />
  );
}

/** A language scope: that language's `config.seo`, saved via updateLanguage.
 *  The server merge spreads the patch over the stored config, so the language's
 *  localized name/description (edited in General) always survive; empty strings
 *  clear a field, and a fully-default language resets its config to null. */
function LanguageSeoForm({ project, language, onDirtyChange }: { project: Project; language: Language; onDirtyChange?: (dirty: boolean) => void }) {
  const t = useT();
  const update = useUpdateLanguage(project.id);
  const seo = language.config?.seo ?? {};
  const projectSeo = project.config?.seo ?? {};
  return (
    <SeoScopeForm
      direction={language.direction === 'RTL' ? 'rtl' : 'ltr'}
      onDirtyChange={onDirtyChange}
      placeholders={{
        metaTitle: projectSeo.metaTitle || undefined,
        metaDescription: projectSeo.metaDescription || undefined,
        socialImage: projectSeo.socialImage || undefined,
      }}
      initial={{
        metaTitle: seo.metaTitle ?? '',
        metaDescription: seo.metaDescription ?? '',
        socialImage: seo.socialImage ?? '',
        allowIndex: seo.allowIndex ?? true,
      }}
      onSave={async (value) => {
        const hasOverride = [value.metaTitle, value.metaDescription, value.socialImage].some((v) => v.trim() !== '') || value.allowIndex === false;
        const config = hasOverride
          ? {
              seo: {
                metaTitle: value.metaTitle.trim(),
                metaDescription: value.metaDescription.trim(),
                socialImage: value.socialImage.trim(),
                allowIndex: value.allowIndex,
              },
            }
          : null;
        try {
          await update.mutateAsync({ id: language.id, body: { config } });
          toast.success(t('common.saved'));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('settings.saveError'));
        }
      }}
      project={project}
    />
  );
}

/** The shared SEO field set (title, description, social image + upload, index
 *  toggle) with the section's single SaveBar — one instance per active scope. */
function SeoScopeForm({
  project,
  initial,
  onSave,
  placeholders,
  onDirtyChange,
  direction,
}: {
  project: Project;
  /** Writing direction of the scoped language; text fields fall back to dir="auto" in the project scope. */
  direction?: 'ltr' | 'rtl';
  initial: SeoValues;
  onSave: (value: SeoValues) => Promise<void>;
  /** Language scopes: the default scope's effective values, shown as
   *  placeholders so the form always reads complete. */
  placeholders?: { metaTitle?: string; metaDescription?: string; socialImage?: string };
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const upload = useUploadAsset(project.id);
  const [allowIndex, setAllowIndex] = useState<boolean>(initial.allowIndex);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // The index toggle lives outside the form, so its dirtiness is tracked by value.
  const toggleDirty = allowIndex !== initial.allowIndex;

  const form = useForm({
    defaultValues: {
      metaTitle: initial.metaTitle,
      metaDescription: initial.metaDescription,
      socialImage: initial.socialImage,
    },
    onSubmit: async ({ value }) => {
      await onSave({ ...value, allowIndex });
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="metaTitle">
        {(field) => (
          <Field hint={t('settings.seo.metaTitle.hint')} label={t('settings.seo.metaTitle.label')}>
            <Input
              className={FIELD_INPUT}
              dir={direction ?? 'auto'}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={placeholders?.metaTitle ?? project.name}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="metaDescription">
        {(field) => (
          <Field hint={t('settings.seo.metaDescription.hint')} label={t('settings.seo.metaDescription.label')}>
            <Textarea
              className={FIELD_TEXTAREA}
              dir={direction ?? 'auto'}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={placeholders?.metaDescription ?? project.description ?? undefined}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="socialImage">
        {(field) => (
          <Field htmlFor="seo-social-image" hint={t('settings.seo.socialImage.hint')} label={t('settings.seo.socialImage.label')}>
            <div className="flex gap-2.5">
              <Input
                className={`${FIELD_MONO} flex-1`}
                dir="ltr"
                id="seo-social-image"
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder={placeholders?.socialImage ?? '/og/cover.png'}
                value={field.state.value}
              />
              <input
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setUploading(true);
                    upload.mutate(file, {
                      onSuccess: (asset) => {
                        field.handleChange(asset.url);
                        setUploading(false);
                        toast.success(t('settings.seo.uploaded'));
                      },
                      onError: (error) => {
                        setUploading(false);
                        toast.error(error instanceof Error ? error.message : t('settings.seo.uploadError'));
                      },
                    });
                  }
                  e.target.value = '';
                }}
                ref={fileRef}
                type="file"
              />
              <Button className="cursor-pointer" disabled={uploading} onClick={() => fileRef.current?.click()} type="button" variant="outline">
                <Upload className="size-4" /> {t('settings.seo.upload')}
              </Button>
            </div>
          </Field>
        )}
      </form.Field>

      <ToggleRow
        checked={allowIndex}
        hint={t('settings.seo.allowIndex.hint')}
        onCheckedChange={setAllowIndex}
        title={t('settings.seo.allowIndex.title')}
      />

      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <DirtyStateReporter dirty={isDirty || toggleDirty} onDirtyChange={onDirtyChange} />}
      </form.Subscribe>

      <div className="mt-4">
        <form.Subscribe selector={(state) => [state.isSubmitting, state.isDirty] as const}>
          {([isSubmitting, isDirty]) => <SaveBar disabled={!isDirty && !toggleDirty} isSubmitting={isSubmitting} />}
        </form.Subscribe>
      </div>
    </form>
  );
}
