import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { Plus, X } from 'lucide-react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { FIELD_COMPACT_MONO, SaveBar, SectionHeader, saveConfigSection } from './shared';

export function VariablesSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);

  const form = useForm({
    defaultValues: {
      variables: (project.config?.variables ?? []).map((pair) => ({ key: pair.key, value: pair.value })),
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        variables: value.variables.filter((pair) => pair.key.trim()),
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
      <SectionHeader icon={<span className="font-mono">{'{}'}</span>} title={t('settings.variables.title')} />
      <p className="mb-5 text-[13.5px] text-muted-foreground leading-relaxed">
        {t('settings.variables.descriptionBefore')}{' '}
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]" dir="ltr">
          {'{{ var.name }}'}
        </span>
        {t('settings.variables.descriptionAfter')}
      </p>

      <form.Field mode="array" name="variables">
        {(field) => (
          <>
            {field.state.value.length > 0 ? (
              <div className="mb-3 overflow-hidden rounded-xl border border-border">
                {field.state.value.map((_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                  <div className="grid grid-cols-[1fr_1.4fr_32px] items-center gap-2.5 border-border border-b p-3 last:border-b-0" key={index}>
                    <form.Field name={`variables[${index}].key`}>
                      {(sub) => (
                        <Input
                          className={FIELD_COMPACT_MONO}
                          aria-label={t('settings.variables.keyLabel')}
                          dir="ltr"
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder="product"
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`variables[${index}].value`}>
                      {(sub) => (
                        <Input
                          className={FIELD_COMPACT_MONO}
                          aria-label={t('settings.variables.valueLabel')}
                          dir="auto"
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder="Acme"
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <Button
                      aria-label={t('settings.variables.remove')}
                      className="text-muted-foreground"
                      onClick={() => field.removeValue(index)}
                      size="icon-xs"
                      type="button"
                      variant="ghost"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            <Button
              className="mb-4 border-dashed text-muted-foreground"
              onClick={() => field.pushValue({ key: '', value: '' })}
              type="button"
              variant="outline"
            >
              <Plus className="size-3.5" /> {t('settings.variables.add')}
            </Button>
          </>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => [state.isSubmitting, state.isDirty] as const}>
        {([isSubmitting, isDirty]) => <SaveBar disabled={!isDirty} isSubmitting={isSubmitting} />}
      </form.Subscribe>
    </form>
  );
}
