import { useForm } from '@tanstack/react-form';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { FIELD_INPUT, Field, GroupLabel, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

export function NavbarSection({ project }: { project: Project }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const navbar = project.config?.navbar ?? {};
  const [showSearch, setShowSearch] = useState<boolean>(navbar.showSearch ?? true);

  const form = useForm({
    defaultValues: {
      ctaLabel: navbar.ctaLabel ?? '',
      ctaUrl: navbar.ctaUrl ?? '',
      links: (navbar.links ?? []).map((link) => ({ label: link.label, href: link.href })),
    },
    onSubmit: async ({ value }) => {
      await saveConfigSection(
        update,
        {
          navbar: {
            ctaLabel: value.ctaLabel.trim() || undefined,
            ctaUrl: value.ctaUrl.trim() || undefined,
            links: value.links.filter((link) => link.label.trim() || link.href.trim()),
            showSearch,
          },
        },
        t,
      );
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <SectionHeader icon="☰" title={t('settings.navbar.title')} />

      <form.Field name="ctaLabel">
        {(field) => (
          <Field hint={t('settings.navbar.ctaLabel.hint')} label={t('settings.navbar.ctaLabel.label')}>
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={t('settings.navbar.ctaLabel.placeholder')}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="ctaUrl">
        {(field) => (
          <Field hint={t('settings.navbar.ctaUrl.hint')} label={t('settings.navbar.ctaUrl.label')}>
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="https://example.com/demo"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <GroupLabel className="mb-2.5">{t('settings.navbar.links.label')}</GroupLabel>
      <form.Field mode="array" name="links">
        {(field) => (
          <>
            {field.state.value.length > 0 ? (
              <div className="mb-3 overflow-hidden rounded-xl border border-border">
                {field.state.value.map((_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder by index
                  <div className="flex items-center gap-2.5 border-border border-b p-3 last:border-b-0" key={index}>
                    <form.Field name={`links[${index}].label`}>
                      {(sub) => (
                        <Input
                          className="h-[34px] flex-1 rounded-lg text-[13px]"
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder={t('settings.navbar.links.labelPlaceholder')}
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`links[${index}].href`}>
                      {(sub) => (
                        <Input
                          className="h-[34px] flex-1 rounded-lg font-mono text-[13px]"
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder="/docs"
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <button
                      aria-label={t('settings.navbar.links.remove')}
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
              className="mb-1.5 flex h-9 cursor-pointer items-center gap-1.5 rounded-[9px] border border-border border-dashed px-3.5 font-medium text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => field.pushValue({ label: '', href: '' })}
              type="button"
            >
              <Plus className="size-3.5" /> {t('settings.navbar.links.add')}
            </button>
          </>
        )}
      </form.Field>

      <ToggleRow
        checked={showSearch}
        hint={t('settings.navbar.showSearch.hint')}
        onCheckedChange={setShowSearch}
        title={t('settings.navbar.showSearch.title')}
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
