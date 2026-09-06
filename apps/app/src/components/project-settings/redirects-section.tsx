import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { useT } from '@nibleaf/i18n/react';
import { validateRedirectGraph } from '@nibleaf/shared/redirects';
import { useForm } from '@tanstack/react-form';
import { ArrowRight, Plus, Route, TriangleAlert, X } from 'lucide-react';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
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
      <SectionHeader icon={<Route className="size-4" />} title={t('settings.redirects.title')} />
      <p className="mb-5 text-[13.5px] text-muted-foreground leading-relaxed">{t('settings.redirects.description')}</p>

      <form.Field mode="array" name="redirects">
        {(field) => (
          <form.Subscribe selector={(state) => state.values.redirects}>
            {(redirects) => {
              const issues = validateRedirectGraph(redirects).issues;
              const invalidRows = new Set(issues.flatMap((issue) => issue.rowIndexes));
              return (
                <>
                  {redirects.length > 0 ? (
                    <div className="mb-3 overflow-hidden rounded-xl border border-border">
                      {redirects.map((_, index) => (
                        <div
                          className="grid grid-cols-[1fr_24px_1fr_32px] items-center gap-2.5 border-border border-b p-3 last:border-b-0"
                          // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
                          key={index}
                        >
                          <form.Field name={`redirects[${index}].from`}>
                            {(sub) => (
                              <Input
                                className={FIELD_COMPACT_MONO}
                                aria-invalid={invalidRows.has(index)}
                                aria-label={t('settings.redirects.fromLabel')}
                                dir="ltr"
                                onChange={(e) => sub.handleChange(e.target.value)}
                                placeholder="/intro"
                                value={sub.state.value}
                              />
                            )}
                          </form.Field>
                          <ArrowRight aria-hidden className="mx-auto size-4 text-muted-foreground rtl:-scale-x-100" />
                          <form.Field name={`redirects[${index}].to`}>
                            {(sub) => (
                              <Input
                                className={FIELD_COMPACT_MONO}
                                aria-invalid={invalidRows.has(index)}
                                aria-label={t('settings.redirects.toLabel')}
                                dir="ltr"
                                onChange={(e) => sub.handleChange(e.target.value)}
                                placeholder="/get-started/introduction"
                                value={sub.state.value}
                              />
                            )}
                          </form.Field>
                          <Button
                            aria-label={t('settings.redirects.remove')}
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
                  <Button
                    className="mb-4 border-dashed text-muted-foreground"
                    onClick={() => field.pushValue({ from: '', to: '' })}
                    type="button"
                    variant="outline"
                  >
                    <Plus className="size-3.5" /> {t('settings.redirects.add')}
                  </Button>
                </>
              );
            }}
          </form.Subscribe>
        )}
      </form.Field>

      <form.Subscribe selector={(state) => [state.isSubmitting, state.isDirty, state.values.redirects] as const}>
        {([isSubmitting, isDirty, redirects]) => (
          <SaveBar isSubmitting={isSubmitting} disabled={!isDirty || validateRedirectGraph(redirects).issues.length > 0} />
        )}
      </form.Subscribe>
    </form>
  );
}
