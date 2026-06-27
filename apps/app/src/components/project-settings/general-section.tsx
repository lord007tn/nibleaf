import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Project } from '@/hooks/api';
import { useUpdateProject } from '@/hooks/api';
import { required } from '@/lib/form';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { FIELD_INPUT, FIELD_TEXTAREA, Field, SaveBar, SectionHeader, Segmented } from './shared';

/** A small curated set of emoji icons the project can use as its avatar glyph. */
const ICON_CHOICES = ['📘', '📕', '📗', '🚀', '⚡', '🛠️', '🧩', '🔌', '📦', '🌐', '🔭', '✨'];

export function GeneralSection({ project }: { project: Project }) {
  const t = useT();
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
              toast.success(t('common.saved'));
              resolve();
            },
            onError: (error) => {
              toast.error(error instanceof Error ? error.message : t('settings.saveError'));
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
      <SectionHeader icon="⊕" title={t('settings.general.title')} />

      <div className="mb-3.5 flex items-center gap-3.5">
        <span className="grid size-[46px] place-items-center rounded-xl bg-primary/10 text-2xl text-primary">{icon}</span>
        <button
          className="h-[34px] cursor-pointer rounded-[9px] border border-border bg-card px-3 text-[13px] hover:bg-muted"
          onClick={() => setIconOpen((open) => !open)}
          type="button"
        >
          {t('settings.general.changeIcon')}
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
          <Field hint={t('settings.general.name.hint')} htmlFor="set-name" label={t('settings.general.name.label')}>
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

      <Field hint={t('settings.general.url.hint')} label={t('settings.general.url.label')}>
        <div className="flex h-[42px] items-center rounded-[10px] border border-border bg-muted/40 px-3 font-mono text-[13px] text-muted-foreground">
          {subdomain}
        </div>
      </Field>

      <form.Field name="description">
        {(field) => (
          <Field hint={t('settings.general.description.hint')} htmlFor="set-desc" label={t('settings.general.description.label')}>
            <Textarea
              className={FIELD_TEXTAREA}
              id="set-desc"
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <Field hint={t('settings.general.visibility.hint')} label={t('settings.general.visibility.label')}>
        <Segmented
          className="max-w-[280px]"
          onChange={setVisibility}
          options={[
            { value: 'public', label: t('settings.general.visibility.public') },
            { value: 'private', label: t('settings.general.visibility.private') },
          ]}
          value={visibility}
        />
      </Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
