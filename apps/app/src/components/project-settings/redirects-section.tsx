import { useForm } from '@tanstack/react-form';
import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { SaveBar, SectionHeader, saveConfigSection } from './shared';

export function RedirectsSection({ project }: { project: Project }) {
  const update = useUpdateProjectConfig(project.id);

  const form = useForm({
    defaultValues: {
      redirects: (project.config?.redirects ?? []).map((pair) => ({ from: pair.from, to: pair.to })),
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(update, {
        redirects: value.redirects.filter((pair) => pair.from.trim() && pair.to.trim()),
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
      <SectionHeader icon="⤳" title="Redirects" />
      <p className="mb-5 text-[13.5px] text-muted-foreground leading-relaxed">Forward old paths to new ones so saved links keep working.</p>

      <form.Field mode="array" name="redirects">
        {(field) => (
          <>
            {field.state.value.length > 0 ? (
              <div className="mb-3 overflow-hidden rounded-xl border border-border">
                {field.state.value.map((_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                  <div className="grid grid-cols-[1fr_24px_1fr_32px] items-center gap-2.5 border-border border-b p-3 last:border-b-0" key={index}>
                    <form.Field name={`redirects[${index}].from`}>
                      {(sub) => (
                        <Input
                          className="h-[34px] rounded-lg font-mono text-[13px]"
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder="/intro"
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <span className="text-center text-muted-foreground">→</span>
                    <form.Field name={`redirects[${index}].to`}>
                      {(sub) => (
                        <Input
                          className="h-[34px] rounded-lg font-mono text-[13px]"
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder="/get-started/introduction"
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <button
                      aria-label="Remove redirect"
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
              onClick={() => field.pushValue({ from: '', to: '' })}
              type="button"
            >
              <Plus className="size-3.5" /> Add redirect
            </button>
          </>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
    </form>
  );
}
