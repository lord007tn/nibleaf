import { useForm } from '@tanstack/react-form';
import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig, useUploadAsset } from '@/hooks/api';
import { FIELD_INPUT, FIELD_MONO, Field, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

export function SeoSection({ project }: { project: Project }) {
  const update = useUpdateProjectConfig(project.id);
  const upload = useUploadAsset(project.id);
  const seo = project.config?.seo ?? {};
  const [allowIndex, setAllowIndex] = useState<boolean>(seo.allowIndex ?? true);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const form = useForm({
    defaultValues: {
      metaTitle: seo.metaTitle ?? '',
      metaDescription: seo.metaDescription ?? '',
      socialImage: seo.socialImage ?? '',
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        seo: {
          metaTitle: value.metaTitle.trim() || undefined,
          metaDescription: value.metaDescription.trim() || undefined,
          socialImage: value.socialImage.trim() || undefined,
          allowIndex,
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
      <SectionHeader icon="◎" title="SEO" />

      <form.Field name="metaTitle">
        {(field) => (
          <Field hint="Title used in search results and social previews." label="Meta title">
            <Input className={FIELD_INPUT} onChange={(e) => field.handleChange(e.target.value)} value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <form.Field name="metaDescription">
        {(field) => (
          <Field hint="The snippet shown under the title in search results." label="Meta description">
            <Textarea
              className="min-h-[84px] rounded-[10px] text-sm"
              onChange={(e) => field.handleChange(e.target.value)}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="socialImage">
        {(field) => (
          <Field hint="Shown when your docs are shared. 1200×630 recommended." label="Social image">
            <div className="flex gap-2.5">
              <Input
                className={`${FIELD_MONO} flex-1`}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="/og/cover.png"
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
                        toast.success('Uploaded');
                      },
                      onError: (error) => {
                        setUploading(false);
                        toast.error(error instanceof Error ? error.message : 'Upload failed');
                      },
                    });
                  }
                  e.target.value = '';
                }}
                ref={fileRef}
                type="file"
              />
              <Button
                className="h-[42px] cursor-pointer rounded-[10px]"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                type="button"
                variant="outline"
              >
                <Upload className="size-4" /> Upload
              </Button>
            </div>
          </Field>
        )}
      </form.Field>

      <ToggleRow
        checked={allowIndex}
        hint="When off, a noindex tag is added to every page."
        onCheckedChange={setAllowIndex}
        title="Allow search engines"
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
