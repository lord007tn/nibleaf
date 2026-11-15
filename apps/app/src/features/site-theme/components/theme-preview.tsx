import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import type { MessageKey } from '@nibleaf/i18n';
import { translateFn, useT } from '@nibleaf/i18n/react';
import { resolveTheme, THEME_PRESETS, type ThemeComponents, type ThemeLayout, type ThemePresetId } from '@nibleaf/shared/themes';
import type { ProjectConfig } from '@nibleaf/validators';
import { type CSSProperties, useId } from 'react';
import { DocumentationStudioPreviewLayout, DocumentationThemeProvider } from '@/components/site/documentation-theme-provider';
import { projectThemeStyle, projectThemeVariables } from '@/lib/site-theme';

type PreviewMode = 'light' | 'dark';

export function ThemePreview({ config, mode, arabic }: { config: ProjectConfig; mode: PreviewMode; arabic: boolean }) {
  const theme = resolveTheme(config);
  const t = (key: MessageKey) => translateFn(key, undefined, arabic ? 'ar' : 'en');
  return (
    <DocumentationThemeProvider
      appearance={mode}
      className="overflow-hidden rounded-xl border border-border text-sm shadow-sm"
      context="studio-preview"
      direction={arabic ? 'rtl' : 'ltr'}
      style={{ ...projectThemeVariables(config, mode), ...projectThemeStyle(config) }}
      theme={theme}
    >
      <DocumentationStudioPreviewLayout
        header={
          <div className="border-border border-b bg-card" data-theme-region="header-shell">
            <div className="flex items-center gap-2 px-3 py-2.5" data-theme-region="header">
              <span className="grid size-6 place-items-center rounded-md bg-primary font-semibold text-primary-foreground">N</span>
              <span className="font-semibold">{t('settings.theme.preview.productDocs')}</span>
              <span className="ms-auto rounded-full border border-border bg-muted px-3 py-1 text-muted-foreground text-xs">
                {t('settings.theme.preview.search')}
              </span>
            </div>
          </div>
        }
        navigation={
          <nav aria-label={t('settings.theme.preview.navigation')}>
            <p className="mb-2 px-2 font-semibold">{t('settings.theme.preview.start')}</p>
            <a className="mb-1 block rounded-md bg-primary/10 px-2 py-1.5 font-medium text-primary" href="#preview-content">
              {t('settings.theme.preview.overview')}
            </a>
            <a className="block rounded-md px-2 py-1.5 text-muted-foreground" href="#preview-code">
              {t('settings.theme.preview.authentication')}
            </a>
          </nav>
        }
        content={
          <article className="min-w-0 p-5" data-theme-region="article" id="preview-content">
            <p className="font-medium text-primary text-xs">{t('settings.theme.preview.guide')}</p>
            <h3 className="mt-1 font-semibold text-xl">{t('settings.theme.preview.title')}</h3>
            <p className="mt-2 text-muted-foreground leading-relaxed">{t('settings.theme.preview.body')}</p>
            <div
              className="mt-4 rounded-lg border p-3"
              data-theme-component="callout"
              style={
                {
                  '--callout-color': 'var(--theme-info)',
                  borderColor: 'color-mix(in oklab,var(--theme-info) 38%,transparent)',
                  background: 'color-mix(in oklab,var(--theme-info) 10%,transparent)',
                } as CSSProperties
              }
            >
              {t('settings.theme.preview.callout')}
            </div>
            <pre
              className="mt-4 overflow-x-auto rounded-lg border border-border bg-(--theme-code) p-3 font-mono text-(--theme-code-foreground) text-xs"
              data-theme-component="code"
              dir="ltr"
              id="preview-code"
            >
              <code>{['curl https://api.example.com/v1/docs \\', '  -H "Authorization: Bearer $TOKEN"'].join('\n')}</code>
            </pre>
            <div className="mt-4 rounded-lg border border-border bg-card p-3" data-theme-component="card">
              <strong>{t('settings.theme.preview.next')}</strong>
              <p className="mt-1 text-muted-foreground">{t('settings.theme.preview.publish')}</p>
            </div>
          </article>
        }
      />
    </DocumentationThemeProvider>
  );
}

const THEME_OPTION_MESSAGE_KEYS = {
  reference: 'settings.theme.option.reference',
  editorial: 'settings.theme.option.editorial',
  console: 'settings.theme.option.console',
  compact: 'settings.theme.option.compact',
  comfortable: 'settings.theme.option.comfortable',
  relaxed: 'settings.theme.option.relaxed',
  focused: 'settings.theme.option.focused',
  balanced: 'settings.theme.option.balanced',
  wide: 'settings.theme.option.wide',
  inline: 'settings.theme.option.inline',
  stacked: 'settings.theme.option.stacked',
  floating: 'settings.theme.option.floating',
  bordered: 'settings.theme.option.bordered',
  soft: 'settings.theme.option.soft',
  rail: 'settings.theme.option.rail',
  tree: 'settings.theme.option.tree',
  sectioned: 'settings.theme.option.sectioned',
  sharp: 'settings.theme.option.sharp',
  rounded: 'settings.theme.option.rounded',
  pill: 'settings.theme.option.pill',
  system: 'settings.theme.option.system',
  dim: 'settings.theme.option.dim',
  vivid: 'settings.theme.option.vivid',
  outline: 'settings.theme.option.outline',
  solid: 'settings.theme.option.solid',
  lifted: 'settings.theme.option.lifted',
  flat: 'settings.theme.option.flat',
  underline: 'settings.theme.option.underline',
  pills: 'settings.theme.option.pills',
  boxed: 'settings.theme.option.boxed',
  lines: 'settings.theme.option.lines',
  rows: 'settings.theme.option.rows',
  cards: 'settings.theme.option.cards',
} as const satisfies Record<ThemeOption, MessageKey>;

type ThemeOption = ThemeLayout[keyof ThemeLayout] | ThemeComponents[keyof ThemeComponents];

/** One layout/component option picker. `items` is built from the same option
 *  array as the menu so the trigger label can never drift from the options. */
export function ThemeOptionSelect<T extends ThemeOption>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  const t = useT();
  const id = useId();
  const items = options.map((option) => ({ value: option, label: t(THEME_OPTION_MESSAGE_KEYS[option]) }));
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs" htmlFor={id}>
        {label}
      </Label>
      <Select
        items={items}
        onValueChange={(next) => {
          if (next) onChange(next);
        }}
        value={value}
      >
        <SelectTrigger className="w-full" id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ThemePresetThumbnail({ presetId }: { presetId: ThemePresetId }) {
  const colors = THEME_PRESETS[presetId].colors.light;
  if (presetId === 'manuscript') {
    return (
      <span className="mb-3 flex h-20 flex-col overflow-hidden rounded-lg border" style={{ background: colors.muted }} aria-hidden>
        <span className="mx-auto mt-2 h-2 w-16 rounded-full" style={{ background: colors.accent }} />
        <span className="mx-3 mt-2 h-2 border-y" style={{ borderColor: colors.border, background: colors.canvas }} />
        <span
          className="mx-auto mt-2 flex h-10 w-2/3 flex-col gap-1 border px-2 py-1.5 shadow-sm"
          style={{ borderColor: colors.border, background: colors.canvas }}
        >
          <span className="h-1 w-1/2 rounded-full" style={{ background: colors.foreground }} />
          <span className="h-1 w-full rounded-full" style={{ background: colors.border }} />
          <span className="h-1 w-4/5 rounded-full" style={{ background: colors.border }} />
        </span>
      </span>
    );
  }
  if (presetId === 'signal') {
    return (
      <span
        className="mb-3 grid h-20 grid-cols-[30%_1fr] grid-rows-[14px_1fr] gap-px overflow-hidden rounded-lg border p-1"
        style={{ background: colors.code }}
        aria-hidden
      >
        <span className="col-span-2 flex items-center gap-1 border px-1" style={{ borderColor: colors.border, background: colors.surface }}>
          <span className="size-1.5 rounded-full" style={{ background: colors.accent }} />
          <span className="h-1 w-10 rounded-full" style={{ background: colors.mutedForeground }} />
        </span>
        <span className="flex flex-col gap-1 border p-1" style={{ borderColor: colors.border, background: colors.code }}>
          <span className="h-1 w-full" style={{ background: colors.accent }} />
          <span className="h-1 w-2/3" style={{ background: colors.mutedForeground }} />
          <span className="h-1 w-4/5" style={{ background: colors.mutedForeground }} />
        </span>
        <span className="flex flex-col gap-1 border p-2" style={{ borderColor: colors.border, background: colors.canvas }}>
          <span className="h-1.5 w-1/2" style={{ background: colors.foreground }} />
          <span className="h-1 w-full" style={{ background: colors.border }} />
          <span className="mt-1 h-3 w-full" style={{ background: colors.code }} />
        </span>
      </span>
    );
  }
  return (
    <span className="mb-3 grid h-20 grid-cols-[28%_1fr_18%] grid-rows-[16px_1fr] overflow-hidden rounded-lg border" aria-hidden>
      <span className="col-span-3 border-b" style={{ borderColor: colors.border, background: colors.canvas }}>
        <span className="m-1.5 block h-1.5 w-10 rounded-full" style={{ background: colors.accent }} />
      </span>
      <span className="border-e" style={{ borderColor: colors.border, background: colors.muted }} />
      <span className="flex flex-col gap-1 p-2" style={{ background: colors.canvas }}>
        <span className="h-1.5 w-1/2 rounded-full" style={{ background: colors.foreground }} />
        <span className="h-1 w-full rounded-full" style={{ background: colors.border }} />
        <span className="h-1 w-4/5 rounded-full" style={{ background: colors.border }} />
      </span>
      <span className="border-s" style={{ borderColor: colors.border, background: colors.surface }} />
    </span>
  );
}
