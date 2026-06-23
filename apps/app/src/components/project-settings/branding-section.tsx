import { useForm } from '@tanstack/react-form';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig, useUploadAsset } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { FIELD_INPUT, FIELD_MONO, Field, SaveBar, SectionHeader, saveConfigSection } from './shared';

type BrandingField = 'logoLight' | 'logoDark' | 'favicon' | 'logoHref';

/** A path/URL input with an Upload button that fills the field via useUploadAsset. */
function UploadField({
  value,
  onChange,
  onUploaded,
  uploading,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onUploaded: (file: File) => void;
  uploading: boolean;
  placeholder?: string;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex gap-2.5">
      <Input className={`${FIELD_MONO} flex-1`} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} value={value} />
      <input
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onUploaded(file);
          }
          e.target.value = '';
        }}
        ref={inputRef}
        type="file"
      />
      <Button
        className="h-[42px] cursor-pointer rounded-[10px]"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        type="button"
        variant="outline"
      >
        <Upload className="size-4" /> {t('settings.branding.upload')}
      </Button>
    </div>
  );
}

export function BrandingSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const upload = useUploadAsset(project.id);
  const [uploadingField, setUploadingField] = useState<BrandingField | null>(null);
  const branding = project.config?.branding ?? {};

  const form = useForm({
    defaultValues: {
      logoLight: branding.logoLight ?? '',
      logoDark: branding.logoDark ?? '',
      favicon: branding.favicon ?? '',
      logoHref: branding.logoHref ?? '',
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(
        update,
        {
          branding: {
            logoLight: value.logoLight.trim() || null,
            logoDark: value.logoDark.trim() || null,
            favicon: value.favicon.trim() || null,
            logoHref: value.logoHref.trim() || null,
          },
        },
        t,
      );
    },
  });

  const handleUpload = (field: BrandingField, file: File) => {
    setUploadingField(field);
    upload.mutate(file, {
      onSuccess: (asset) => {
        form.setFieldValue(field, asset.url);
        setUploadingField(null);
        toast.success(t('settings.branding.uploaded'));
      },
      onError: (error) => {
        setUploadingField(null);
        toast.error(error instanceof Error ? error.message : t('settings.branding.uploadError'));
      },
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <SectionHeader icon="▣" title={t('settings.branding.title')} />

      <form.Field name="logoLight">
        {(field) => (
          <Field hint={t('settings.branding.logoLight.hint')} label={t('settings.branding.logoLight.label')}>
            <UploadField
              onChange={field.handleChange}
              onUploaded={(file) => handleUpload('logoLight', file)}
              placeholder="/logo/light.svg"
              uploading={uploadingField === 'logoLight'}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="logoDark">
        {(field) => (
          <Field hint={t('settings.branding.logoDark.hint')} label={t('settings.branding.logoDark.label')}>
            <UploadField
              onChange={field.handleChange}
              onUploaded={(file) => handleUpload('logoDark', file)}
              placeholder="/logo/dark.svg"
              uploading={uploadingField === 'logoDark'}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="favicon">
        {(field) => (
          <Field hint={t('settings.branding.favicon.hint')} label={t('settings.branding.favicon.label')}>
            <UploadField
              onChange={field.handleChange}
              onUploaded={(file) => handleUpload('favicon', file)}
              placeholder="/favicon.svg"
              uploading={uploadingField === 'favicon'}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="logoHref">
        {(field) => (
          <Field hint={t('settings.branding.logoHref.hint')} label={t('settings.branding.logoHref.label')}>
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="https://example.com"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
