import { Input } from '@nibleaf/design-system/components/ui/input';
import { validateRedirectGraph } from '@nibleaf/shared/redirects';
import { useForm } from '@tanstack/react-form';
import { Plus, TriangleAlert, X } from 'lucide-react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { FIELD_COMPACT_MONO, SaveBar, SectionHeader, saveConfigSection } from './shared';

export function RedirectsSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);

  const form = useForm({
    defaultValues: {
      redirects: (project.config?.redirects ?? []).map((pair) => ({ from: pair.from, to: pair.to })),
    },
    onSubmit: async ({ value }) => {
      if (validateRedirectGraph(value.redirects).issues.length > 0) {
        return;
      }
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
      <SectionHeader icon="⤳" title={t('settings.redirects.title')} />
      <p className="mb-5 text-[13.5px] text-muted-foreground leading-relaxed">{t('settings.redirects.description')}</p>

      <form.Field mode="array" name="redirects">
        {(field) => {
          const issues = validateRedirectGraph(field.state.value).issues;
          const invalidRows = new Set(issues.flatMap((issue) => issue.rowIndexes));
          return (
            <>
              {field.state.value.length > 0 ? (
                <div className="mb-3 overflow-hidden rounded-xl border border-border">
                  {field.state.value.map((_, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                    <div className="grid grid-cols-[1fr_24px_1fr_32px] items-center gap-2.5 border-border border-b p-3 last:border-b-0" key={index}>
                      <form.Field name={`redirects[${index}].from`}>
                        {(sub) => (
                          <Input
                            className={FIELD_COMPACT_MONO}
                            aria-invalid={invalidRows.has(index)}
                            aria-label={t('settings.redirects.fromLabel')}
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
                            className={FIELD_COMPACT_MONO}
                            aria-invalid={invalidRows.has(index)}
                            aria-label={t('settings.redirects.toLabel')}
                            onChange={(e) => sub.handleChange(e.target.value)}
                            placeholder="/get-started/introduction"
                            value={sub.state.value}
                          />
                        )}
                      </form.Field>
                      <button
                        aria-label={t('settings.redirects.remove')}
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
              {issues.length > 0 ? (
                <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/5 p-3" role="alert">
                  <div className="flex items-center gap-2 font-medium text-destructive text-xs">
                    <TriangleAlert className="size-3.5" /> {t('settings.redirects.invalid')}
                  </div>
                  <ul className="mt-2 space-y-1 text-[11.5px] text-muted-foreground">
                    {issues.map((issue) => (
                      <li key={`${issue.code}-${issue.rowIndexes.join('-')}-${issue.sequence.join('-')}-${issue.message}`}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <button
                className="mb-4 flex h-9 cursor-pointer items-center gap-1.5 rounded-[9px] border border-border border-dashed px-3.5 font-medium text-[13px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => field.pushValue({ from: '', to: '' })}
                type="button"
              >
                <Plus className="size-3.5" /> {t('settings.redirects.add')}
              </button>
            </>
          );
        }}
      </form.Field>

      <form.Subscribe selector={(state) => [state.isSubmitting, state.values.redirects] as const}>
        {([isSubmitting, redirects]) => <SaveBar isSubmitting={isSubmitting} disabled={validateRedirectGraph(redirects).issues.length > 0} />}
      </form.Subscribe>
    </form>
  );
}
