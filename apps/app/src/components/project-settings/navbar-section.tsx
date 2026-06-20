import { useForm } from '@tanstack/react-form';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { FIELD_INPUT, Field, GroupLabel, SaveBar, SectionHeader, saveConfigSection, ToggleRow } from './shared';

export function NavbarSection({ project }: { project: Project }) {
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
      await saveConfigSection(update, {
        navbar: {
          ctaLabel: value.ctaLabel.trim() || undefined,
          ctaUrl: value.ctaUrl.trim() || undefined,
          links: value.links.filter((link) => link.label.trim() || link.href.trim()),
          showSearch,
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
      <SectionHeader icon="☰" title="Navbar" />

      <form.Field name="ctaLabel">
        {(field) => (
          <Field hint="The highlighted button on the right of the navbar." label="Primary CTA label">
            <Input className={FIELD_INPUT} onChange={(e) => field.handleChange(e.target.value)} placeholder="Book a demo" value={field.state.value} />
          </Field>
        )}
      </form.Field>

      <form.Field name="ctaUrl">
        {(field) => (
          <Field hint="Where the CTA button links to." label="Primary CTA URL">
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="https://example.com/demo"
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      <GroupLabel className="mb-2.5">Navbar links</GroupLabel>
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
                          placeholder="Documentation"
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
                      aria-label="Remove link"
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
              <Plus className="size-3.5" /> Add link
            </button>
          </>
        )}
      </form.Field>

      <ToggleRow
        checked={showSearch}
        hint="Display the ⌘K search field in the top bar."
        onCheckedChange={setShowSearch}
        title="Show search in navbar"
      />

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
