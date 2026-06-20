import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Project } from '@/hooks/api';
import { useUpdateProject } from '@/hooks/api';
import { required } from '@/lib/form';
import { cn } from '@/lib/utils';
import { FIELD_INPUT, Field, SaveBar, SectionHeader, Segmented } from './shared';

/** A small curated set of emoji icons the project can use as its avatar glyph. */
const ICON_CHOICES = ['📘', '📕', '📗', '🚀', '⚡', '🛠️', '🧩', '🔌', '📦', '🌐', '🔭', '✨'];

export function GeneralSection({ project }: { project: Project }) {
  const update = useUpdateProject(project.id);
  const [icon, setIcon] = useState<string>(project.icon ?? '📘');
  const [iconOpen, setIconOpen] = useState(false);
  const [visibility, setVisibility] = useState<'public' | 'private'>(project.config?.visibility ?? 'public');

  const form = useForm({
    defaultValues: { name: project.name, description: project.description ?? '' },
    onSubmit: async ({ value }) => {
      await new Promise<void>((resolve) => {
        update.mutate(
          {
            name: value.name.trim(),
            description: value.description.trim() ? value.description.trim() : null,
            icon,
            config: { visibility },
          },
          {
            onSuccess: () => {
              toast.success('Saved');
              resolve();
            },
            onError: (error) => {
              toast.error(error instanceof Error ? error.message : 'Could not save');
              resolve();
            },
          },
        );
      });
    },
  });

  const subdomain = `${project.slug}.plume.app`;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <SectionHeader icon="⊕" title="General" />

      <div className="mb-3.5 flex items-center gap-3.5">
        <span className="grid size-[46px] place-items-center rounded-xl bg-primary/10 text-2xl text-primary">{icon}</span>
        <button
          className="h-[34px] cursor-pointer rounded-[9px] border border-border bg-card px-3 text-[13px] hover:bg-muted"
          onClick={() => setIconOpen((open) => !open)}
          type="button"
        >
          Change icon
        </button>
      </div>
      {iconOpen ? (
        <div className="mb-5 flex flex-wrap gap-2 rounded-xl border border-border bg-muted/40 p-3.5">
          {ICON_CHOICES.map((choice) => {
            const active = choice === icon;
            return (
              <button
                className={cn(
                  'grid size-[38px] cursor-pointer place-items-center rounded-[9px] border text-base',
                  active ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted',
                )}
                key={choice}
                onClick={() => {
                  setIcon(choice);
                  setIconOpen(false);
                }}
                type="button"
              >
                {choice}
              </button>
            );
          })}
        </div>
      ) : null}

      <form.Field name="name" validators={{ onChange: ({ value }) => required('Name')(value) }}>
        {(field) => (
          <Field hint="The name of the project, shown in the navbar and browser tab." htmlFor="set-name" label="Name">
            <Input
              className={FIELD_INPUT}
              id="set-name"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              value={field.state.value}
            />
            <FieldError errors={field.state.meta.errors} />
          </Field>
        )}
      </form.Field>

      <Field hint="Your free Plume subdomain. Add a custom domain below to override it." label="Plume URL">
        <div className="flex h-[42px] items-center rounded-[10px] border border-border bg-muted/40 px-3 font-mono text-[13px] text-muted-foreground">
          {subdomain}
        </div>
      </Field>

      <form.Field name="description">
        {(field) => (
          <Field hint="Brief overview of the project. Used for SEO and AEO." htmlFor="set-desc" label="Description">
            <Textarea
              className="min-h-[84px] rounded-[10px] text-sm"
              id="set-desc"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <Field hint="Public sites are indexable. Private sites require a login." label="Visibility">
        <Segmented
          className="max-w-[280px]"
          onChange={setVisibility}
          options={[
            { value: 'public', label: 'Public' },
            { value: 'private', label: 'Private' },
          ]}
          value={visibility}
        />
      </Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
