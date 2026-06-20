import { useForm } from '@tanstack/react-form';
import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { SaveBar, SectionHeader, saveConfigSection } from './shared';

export function VariablesSection({ project }: { project: Project }) {
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
      <SectionHeader icon={<span className="font-mono">{'{}'}</span>} title="Variables" />
      <p className="mb-5 text-[13.5px] text-muted-foreground leading-relaxed">
        Reusable values you can reference in any page with{' '}
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">{'{{ var.name }}'}</span>.
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
                          className="h-[34px] rounded-lg font-mono text-[13px]"
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder="product"
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`variables[${index}].value`}>
                      {(sub) => (
                        <Input
                          className="h-[34px] rounded-lg font-mono text-[13px]"
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder="Acme"
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <button
                      aria-label="Remove variable"
                      className="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => field.removeValue(index)}
                      type="button"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <button
              className="mb-4 flex h-9 cursor-pointer items-center gap-1.5 rounded-[9px] border border-border border-dashed px-3.5 font-medium text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => field.pushValue({ key: '', value: '' })}
              type="button"
            >
              <Plus className="size-3.5" /> Add variable
            </button>
          </>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
