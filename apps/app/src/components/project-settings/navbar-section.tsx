import { Input } from '@nibleaf/design-system/components/ui/input';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { LanguageConfig } from '@nibleaf/validators';
import { useForm } from '@tanstack/react-form';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Language, Project } from '@/hooks/api';
import { useLanguages, useUpdateLanguage, useUpdateProjectConfig } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import {
  DirtyStateReporter,
  FIELD_COMPACT,
  FIELD_COMPACT_MONO,
  FIELD_INPUT,
  Field,
  GroupLabel,
  LanguageScopePicker,
  SaveBar,
  SectionHeader,
  saveConfigSection,
  ToggleRow,
  useScopeDirtyGuard,
} from './shared';

interface NavRow {
  label: string;
  href: string;
  external?: boolean;
}
interface AnchorRow extends NavRow {
  icon: string;
}

/** The editable navbar values shared by the project scope and a language scope.
 *  Language scopes localize labels/links only — the CTA URL and the search /
 *  changelog toggles stay global (project scope). */
interface NavbarValues {
  ctaLabel: string;
  ctaUrl: string;
  links: NavRow[];
  tabs: NavRow[];
  anchors: AnchorRow[];
}

/** Navbar with a per-language scope: "Default" edits `project.config.navbar`
 *  exactly as before; a language scope edits that language's `config.navbar`
 *  override (labels/links shown to visitors browsing that language). */
export function NavbarSection({ project }: { project: Project }) {
  const t = useT();
  const { data: languages } = useLanguages(project.id);
  const extraLanguages = (languages ?? []).filter((language) => !language.isDefault);
  const [scope, setScope] = useState<string>('default');
  const activeLanguage = extraLanguages.find((language) => language.id === scope);
  const { guard, setDirty } = useScopeDirtyGuard();

  return (
    <div>
      <SectionHeader icon="☰" title={t('settings.navbar.title')} />
      <LanguageScopePicker guard={guard} hint={t('settings.navbar.scope.hint')} languages={extraLanguages} onChange={setScope} value={scope} />
      {/* Keyed per scope so switching re-seeds the form from that scope's config. */}
      {activeLanguage ? (
        <LanguageNavbarForm key={activeLanguage.id} language={activeLanguage} onDirtyChange={setDirty} project={project} />
      ) : (
        <ProjectNavbarForm key="default" onDirtyChange={setDirty} project={project} />
      )}
    </div>
  );
}

const cleanRows = (rows: NavRow[]): Array<{ label: string; href: string; external?: boolean }> =>
  rows.filter((row) => row.label.trim() || row.href.trim()).map((row) => ({ label: row.label, href: row.href, external: row.external }));

const cleanAnchorRows = (rows: AnchorRow[]): Array<{ label: string; href: string; icon?: string; external?: boolean }> =>
  rows
    .filter((row) => row.label.trim() || row.href.trim())
    .map((row) => ({ label: row.label, href: row.href, icon: row.icon.trim() || undefined, external: row.external }));

/** Default scope: the project-level navbar in `project.config.navbar` (unchanged). */
function ProjectNavbarForm({ project, onDirtyChange }: { project: Project; onDirtyChange?: (dirty: boolean) => void }) {
  const t = useT();
  const update = useUpdateProjectConfig(project.id);
  const navbar = project.config?.navbar ?? {};
  const [showSearch, setShowSearch] = useState<boolean>(navbar.showSearch ?? true);
  const [showChangelog, setShowChangelog] = useState<boolean>(navbar.changelog ?? false);

  return (
    <NavbarScopeForm
      extraDirty={showSearch !== (navbar.showSearch ?? true) || showChangelog !== (navbar.changelog ?? false)}
      onDirtyChange={onDirtyChange}
      extraToggles={
        <>
          <ToggleRow
            checked={showSearch}
            hint={t('settings.navbar.showSearch.hint')}
            onCheckedChange={setShowSearch}
            title={t('settings.navbar.showSearch.title')}
          />
          <ToggleRow
            checked={showChangelog}
            hint={t('settings.navbar.changelog.hint')}
            onCheckedChange={setShowChangelog}
            title={t('settings.navbar.changelog.title')}
          />
        </>
      }
      initial={{
        ctaLabel: navbar.ctaLabel ?? '',
        ctaUrl: navbar.ctaUrl ?? '',
        links: (navbar.links ?? []).map((link) => ({ label: link.label, href: link.href, external: link.external })),
        tabs: (navbar.tabs ?? []).map((tab) => ({ label: tab.label, href: tab.href, external: tab.external })),
        anchors: (navbar.anchors ?? []).map((anchor) => ({
          label: anchor.label,
          href: anchor.href,
          icon: anchor.icon ?? '',
          external: anchor.external,
        })),
      }}
      onSave={(value) =>
        saveConfigSection(update, {
          navbar: {
            ctaLabel: value.ctaLabel.trim() || undefined,
            ctaUrl: value.ctaUrl.trim() || undefined,
            links: cleanRows(value.links),
            tabs: cleanRows(value.tabs),
            anchors: cleanAnchorRows(value.anchors),
            showSearch,
            changelog: showChangelog,
          },
        })
      }
      showGlobalFields
    />
  );
}

/** A language scope: that language's `config.navbar` override, saved via
 *  updateLanguage. The override always carries the FULL section (only the
 *  non-empty pieces); when every field is empty it is cleared with `null` so
 *  the language falls back to the project navbar. The server merge preserves
 *  the language's name/description/seo untouched. */
function LanguageNavbarForm({
  project,
  language,
  onDirtyChange,
}: {
  project: Project;
  language: Language;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const t = useT();
  const update = useUpdateLanguage(project.id);
  const override: NonNullable<LanguageConfig['navbar']> = language.config?.navbar ?? {};

  return (
    <NavbarScopeForm
      ctaLabelPlaceholder={project.config?.navbar?.ctaLabel || undefined}
      onDirtyChange={onDirtyChange}
      initial={{
        ctaLabel: override.ctaLabel ?? '',
        ctaUrl: '',
        links: (override.links ?? []).map((link) => ({ label: link.label, href: link.href, external: link.external })),
        tabs: (override.tabs ?? []).map((tab) => ({ label: tab.label, href: tab.href, external: tab.external })),
        anchors: (override.anchors ?? []).map((anchor) => ({
          label: anchor.label,
          href: anchor.href,
          icon: anchor.icon ?? '',
          external: anchor.external,
        })),
      }}
      onSave={async (value) => {
        const navbar: NonNullable<LanguageConfig['navbar']> = {};
        if (value.ctaLabel.trim()) {
          navbar.ctaLabel = value.ctaLabel.trim();
        }
        const links = cleanRows(value.links);
        if (links.length > 0) {
          navbar.links = links;
        }
        const tabs = cleanRows(value.tabs);
        if (tabs.length > 0) {
          navbar.tabs = tabs;
        }
        const anchors = cleanAnchorRows(value.anchors);
        if (anchors.length > 0) {
          navbar.anchors = anchors;
        }
        try {
          await update.mutateAsync({ id: language.id, body: { config: { navbar: Object.keys(navbar).length > 0 ? navbar : null } } });
          toast.success(t('common.saved'));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : t('settings.saveError'));
        }
      }}
    />
  );
}

/** The shared navbar field set (CTA, links, tabs, anchors) with the section's
 *  single SaveBar — one instance per active scope. Global-only fields (CTA URL,
 *  toggles) render only for the project scope. */
function NavbarScopeForm({
  initial,
  onSave,
  showGlobalFields = false,
  extraToggles,
  ctaLabelPlaceholder,
  onDirtyChange,
  extraDirty = false,
}: {
  initial: NavbarValues;
  onSave: (value: NavbarValues) => Promise<void>;
  showGlobalFields?: boolean;
  extraToggles?: React.ReactNode;
  ctaLabelPlaceholder?: string;
  onDirtyChange?: (dirty: boolean) => void;
  /** Dirtiness of scope state held outside the form (the project scope's toggles). */
  extraDirty?: boolean;
}) {
  const t = useT();
  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      await onSave(value);
    },
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Field name="ctaLabel">
        {(field) => (
          <Field hint={t('settings.navbar.ctaLabel.hint')} label={t('settings.navbar.ctaLabel.label')}>
            <Input
              className={FIELD_INPUT}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder={ctaLabelPlaceholder ?? t('settings.navbar.ctaLabel.placeholder')}
              value={field.state.value}
            />
          </Field>
        )}
      </form.Field>

      {showGlobalFields ? (
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
      ) : null}

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
                          className={cn(FIELD_COMPACT, 'flex-1')}
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder={t('settings.navbar.links.labelPlaceholder')}
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`links[${index}].href`}>
                      {(sub) => (
                        <Input
                          className={cn(FIELD_COMPACT_MONO, 'flex-1')}
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
              onClick={() => field.pushValue({ label: '', href: '', external: undefined })}
              type="button"
            >
              <Plus className="size-3.5" /> {t('settings.navbar.links.add')}
            </button>
          </>
        )}
      </form.Field>

      <GroupLabel className="mt-6 mb-1">{t('settings.navbar.tabs.label')}</GroupLabel>
      <p className="mb-2.5 text-[12px] text-muted-foreground leading-snug">{t('settings.navbar.tabs.hint')}</p>
      <form.Field mode="array" name="tabs">
        {(field) => (
          <>
            {field.state.value.length > 0 ? (
              <div className="mb-3 overflow-hidden rounded-xl border border-border">
                {field.state.value.map((_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder by index
                  <div className="flex items-center gap-2.5 border-border border-b p-3 last:border-b-0" key={index}>
                    <form.Field name={`tabs[${index}].label`}>
                      {(sub) => (
                        <Input
                          className={cn(FIELD_COMPACT, 'flex-1')}
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder={t('settings.navbar.tabs.labelPlaceholder')}
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`tabs[${index}].href`}>
                      {(sub) => (
                        <Input
                          className={cn(FIELD_COMPACT_MONO, 'flex-1')}
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder="/guides"
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <button
                      aria-label={t('settings.navbar.tabs.remove')}
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
              onClick={() => field.pushValue({ label: '', href: '', external: undefined })}
              type="button"
            >
              <Plus className="size-3.5" /> {t('settings.navbar.tabs.add')}
            </button>
          </>
        )}
      </form.Field>

      <GroupLabel className="mt-6 mb-1">{t('settings.navbar.anchors.label')}</GroupLabel>
      <p className="mb-2.5 text-[12px] text-muted-foreground leading-snug">{t('settings.navbar.anchors.hint')}</p>
      <form.Field mode="array" name="anchors">
        {(field) => (
          <>
            {field.state.value.length > 0 ? (
              <div className="mb-3 overflow-hidden rounded-xl border border-border">
                {field.state.value.map((_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and reorder by index
                  <div className="flex items-center gap-2.5 border-border border-b p-3 last:border-b-0" key={index}>
                    <form.Field name={`anchors[${index}].label`}>
                      {(sub) => (
                        <Input
                          className={cn(FIELD_COMPACT, 'flex-1')}
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder={t('settings.navbar.anchors.labelPlaceholder')}
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`anchors[${index}].href`}>
                      {(sub) => (
                        <Input
                          className={cn(FIELD_COMPACT_MONO, 'flex-1')}
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder="https://community.example.com"
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <form.Field name={`anchors[${index}].icon`}>
                      {(sub) => (
                        <Input
                          className={cn(FIELD_COMPACT, 'w-[104px] shrink-0')}
                          onChange={(e) => sub.handleChange(e.target.value)}
                          placeholder={t('settings.navbar.anchors.iconPlaceholder')}
                          value={sub.state.value}
                        />
                      )}
                    </form.Field>
                    <button
                      aria-label={t('settings.navbar.anchors.remove')}
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
              onClick={() => field.pushValue({ label: '', href: '', icon: '', external: undefined })}
              type="button"
            >
              <Plus className="size-3.5" /> {t('settings.navbar.anchors.add')}
            </button>
          </>
        )}
      </form.Field>

      {extraToggles}

      <form.Subscribe selector={(state) => state.isDirty}>
        {(isDirty) => <DirtyStateReporter dirty={isDirty || extraDirty} onDirtyChange={onDirtyChange} />}
      </form.Subscribe>

      <div className="mt-4">
        <form.Subscribe selector={(state) => state.isSubmitting}>{(isSubmitting) => <SaveBar isSubmitting={isSubmitting} />}</form.Subscribe>
      </div>
    </form>
  );
}
