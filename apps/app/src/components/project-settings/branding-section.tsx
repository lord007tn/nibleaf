import { useForm } from '@tanstack/react-form';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig, useUploadAsset } from '@/hooks/api';
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
        <Upload className="size-4" /> Upload
      </Button>
    </div>
  );
}

export function BrandingSection({ project }: { project: Project }) {
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
      await saveConfigSection(update, {
        branding: {
          logoLight: value.logoLight.trim() || null,
          logoDark: value.logoDark.trim() || null,
          favicon: value.favicon.trim() || null,
          logoHref: value.logoHref.trim() || null,
        },
      });
    },
  });

  const handleUpload = (field: BrandingField, file: File) => {
    setUploadingField(field);
    upload.mutate(file, {
      onSuccess: (asset) => {
        form.setFieldValue(field, asset.url);
        setUploadingField(null);
        toast.success('Uploaded');
      },
      onError: (error) => {
        setUploadingField(null);
        toast.error(error instanceof Error ? error.message : 'Upload failed');
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
      <SectionHeader icon="▣" title="Branding" />

      <form.Field name="logoLight">
        {(field) => (
          <Field hint="The light version of the logo, used in dark mode. Include the file extension." label="Logo light">
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
          <Field hint="The dark version of the logo, used in light mode. Include the file extension." label="Logo dark">
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
          <Field hint="Shown in the browser tab. A 48×48 PNG or SVG works best." label="Favicon">
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
          <Field hint="The URL to open when the logo is clicked. Defaults to the homepage." label="Logo destination">
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
