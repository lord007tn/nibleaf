import { cn } from '@nibleaf/design-system/lib/utils';
import {
  MAX_THEME_TEMPLATE_BYTES,
  type NibleafThemeConfig,
  resolveTheme,
  THEME_COLOR_KEYS,
  THEME_PRESET_IDS,
  THEME_PRESETS,
  THEME_SCHEMA_VERSION,
  type ThemeColorKey,
  type ThemeConfigChange,
  type ThemeOwnedProjectConfig,
  type ThemePresetId,
  type ThemeTemplateV1,
  themeContrastIssues,
} from '@nibleaf/shared/themes';
import type { ProjectConfig } from '@nibleaf/validators';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileJson, RotateCcw, Undo2, Upload } from 'lucide-react';
import { type ChangeEvent, type CSSProperties, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@/hooks/api';
import { queryKeys, useUpdateProjectConfig } from '@/hooks/api';
import { getData, mutateData } from '@/hooks/api/client-helpers';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { projectThemeStyle, projectThemeVariables } from '@/lib/site-theme';
import { Field, SaveBar, SectionHeader, Segmented } from './shared';

type Appearance = 'light' | 'dark' | 'system';
type PreviewMode = 'light' | 'dark';
type ImportMode = 'merge' | 'replace';

interface ThemeDraft {
  theme: NibleafThemeConfig;
  appearance: Appearance;
}

interface ThemeExportResult {
  template: ThemeTemplateV1;
  json: string;
}

interface ThemeImportResult {
  applied: boolean;
  mode: ImportMode;
  migratedFrom?: 0;
  changes: ThemeConfigChange[];
  theme: ReturnType<typeof resolveTheme>;
  template: ThemeTemplateV1;
  publishedChangesPending: boolean;
}

const fullPresetTheme = (preset: ThemePresetId): NibleafThemeConfig => {
  const definition = THEME_PRESETS[preset];
  return {
    version: THEME_SCHEMA_VERSION,
    preset,
    metadata: definition.metadata,
    colors: { light: { ...definition.colors.light }, dark: { ...definition.colors.dark } },
    layout: { ...definition.layout },
    components: { ...definition.components },
  };
};

const initialDraft = (project: Project): ThemeDraft => {
  const resolved = resolveTheme(project.config as ThemeOwnedProjectConfig | null);
  return {
    theme: project.config?.theme ?? { version: THEME_SCHEMA_VERSION, preset: resolved.id, metadata: resolved.metadata },
    appearance: project.config?.styling?.theme ?? 'light',
  };
};

const COLOR_FIELDS = THEME_COLOR_KEYS satisfies ReadonlyArray<ThemeColorKey>;

const valueLabel = (value: unknown): string => {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
};

const downloadText = (fileName: string, contents: string) => {
  const href = URL.createObjectURL(new Blob([contents], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(href);
};

export function ThemePreview({ config, mode, arabic }: { config: ProjectConfig; mode: PreviewMode; arabic: boolean }) {
  const theme = resolveTheme(config as ThemeOwnedProjectConfig);
  return (
    <div
      className={cn('nibleaf-site-chrome overflow-hidden rounded-xl border border-border text-sm shadow-sm', mode === 'dark' && 'dark')}
      data-theme-callouts={theme.components.callouts}
      data-theme-context="studio-preview"
      data-theme-cards={theme.components.cards}
      data-theme-code={theme.components.codeBlocks}
      data-theme-density={theme.layout.density}
      data-theme-header={theme.layout.header}
      data-theme-id={theme.id}
      data-theme-navigation={theme.layout.navigation}
      data-theme-shell={theme.layout.shell}
      data-theme-sidebar={theme.layout.sidebar}
      data-theme-tables={theme.components.tables}
      data-theme-tabs={theme.components.tabs}
      data-theme-width={theme.layout.contentWidth}
      dir={arabic ? 'rtl' : 'ltr'}
      style={{ ...projectThemeVariables(config, mode), ...projectThemeStyle(config) }}
    >
      <div className="border-border border-b bg-card" data-theme-region="header-shell">
        <div className="flex items-center gap-2 px-3 py-2.5" data-theme-region="header">
          <span className="grid size-6 place-items-center rounded-md bg-primary font-semibold text-primary-foreground">N</span>
          <span className="font-semibold">{arabic ? 'وثائق المنتج' : 'Product docs'}</span>
          <span className="ms-auto rounded-full border border-border bg-muted px-3 py-1 text-muted-foreground text-xs">
            {arabic ? 'ابحث في الوثائق' : 'Search documentation'}
          </span>
        </div>
      </div>
      <div className="grid min-h-[22rem] grid-cols-[7.5rem_minmax(0,1fr)]" data-theme-region="preview-shell">
        <div className="border-border border-e bg-card/45 p-2 text-xs" data-theme-region="sidebar">
          <nav aria-label={arabic ? 'التنقل التجريبي' : 'Preview navigation'}>
            <p className="mb-2 px-2 font-semibold">{arabic ? 'البدء' : 'Start here'}</p>
            <a className="mb-1 block rounded-md bg-primary/10 px-2 py-1.5 font-medium text-primary" href="#preview-content">
              {arabic ? 'نظرة عامة' : 'Overview'}
            </a>
            <a className="block rounded-md px-2 py-1.5 text-muted-foreground" href="#preview-code">
              {arabic ? 'المصادقة' : 'Authentication'}
            </a>
          </nav>
        </div>
        <article className="min-w-0 p-5" data-theme-region="article" id="preview-content">
          <p className="font-medium text-primary text-xs">{arabic ? 'دليل سريع' : 'Quick guide'}</p>
          <h3 className="mt-1 font-semibold text-xl">{arabic ? 'ابدأ التكامل' : 'Build your first integration'}</h3>
          <p className="mt-2 text-muted-foreground leading-relaxed">
            {arabic
              ? 'استخدم إعدادات واضحة وآمنة، مع بقاء أوامر الشيفرة باتجاهها الصحيح.'
              : 'Use safe, predictable defaults while every component inherits your semantic theme.'}
          </p>
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
            {arabic ? 'تدعم الواجهة العربية والإنجليزية من المصدر.' : 'Arabic and English share the same accessible token contract.'}
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
            <strong>{arabic ? 'الخطوة التالية' : 'Next step'}</strong>
            <p className="mt-1 text-muted-foreground">
              {arabic ? 'انشر مسودة موثقة عندما تصبح جاهزة.' : 'Publish the reviewed draft when it is ready.'}
            </p>
          </div>
        </article>
      </div>
    </div>
  );
}

function NativeSelect<T extends string>({
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
  return (
    <label className="grid gap-1.5 text-[12.5px]">
      <span className="font-medium">{label}</span>
      <select
        className="h-9 rounded-md border border-input bg-background px-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        onChange={(event) => onChange(event.target.value as T)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ThemeSection({ project }: { project: Project }) {
  const t = useT();
  const queryClient = useQueryClient();
  const updateConfig = useUpdateProjectConfig(project.id);
  const saved = useMemo(() => initialDraft(project), [project]);
  const [draft, setDraft] = useState<ThemeDraft>(saved);
  const [history, setHistory] = useState<ThemeDraft[]>([]);
  const [previewMode, setPreviewMode] = useState<PreviewMode>(saved.appearance === 'dark' ? 'dark' : 'light');
  const [previewArabic, setPreviewArabic] = useState(false);
  const [colorMode, setColorMode] = useState<PreviewMode>('light');
  const [importMode, setImportMode] = useState<ImportMode>('merge');
  const [importText, setImportText] = useState('');
  const [importTemplate, setImportTemplate] = useState<unknown>();
  const [importPreview, setImportPreview] = useState<ThemeImportResult>();
  const fileInput = useRef<HTMLInputElement>(null);

  const change = (next: ThemeDraft | ((current: ThemeDraft) => ThemeDraft)) => {
    setDraft((current) => {
      setHistory((items) => [...items.slice(-19), current]);
      return typeof next === 'function' ? next(current) : next;
    });
  };
  const config = {
    ...(project.config ?? {}),
    theme: draft.theme,
    styling: { ...(project.config?.styling ?? {}), theme: draft.appearance },
  } satisfies ProjectConfig;
  const resolved = resolveTheme(config as ThemeOwnedProjectConfig);
  const contrastIssues = themeContrastIssues(resolved);
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(saved);

  const previewImport = useMutation({
    mutationFn: async ({ template, apply }: { template: unknown; apply: boolean }) =>
      mutateData<ThemeImportResult>(
        await api.app.projects[':id']['theme-template'].import.$post({
          param: { id: project.id },
          json: { template, mode: importMode, apply },
        }),
        apply ? t('settings.theme.import.applyError') : t('settings.theme.import.previewError'),
      ),
    onSuccess: (result, variables) => {
      setImportPreview(result);
      if (variables.apply) {
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(project.id) });
        setDraft({
          theme: result.template.config.theme ?? fullPresetTheme(result.theme.id),
          appearance: result.template.config.styling?.theme ?? 'light',
        });
        setHistory([]);
        toast.success(t('settings.theme.import.applied'));
      }
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.theme.import.previewError')),
  });

  const exportTheme = useMutation({
    mutationFn: async () =>
      getData<ThemeExportResult>(await api.app.projects[':id']['theme-template'].$get({ param: { id: project.id } }), 'theme template'),
    onSuccess: ({ json }) => {
      downloadText(`${project.slug || 'nibleaf'}-theme.json`, json);
      toast.success(t('settings.theme.exported'));
    },
    onError: () => toast.error(t('settings.theme.exportError')),
  });

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportText('');
    setImportTemplate(undefined);
    setImportPreview(undefined);
    if (file.size > MAX_THEME_TEMPLATE_BYTES) {
      toast.error(t('settings.theme.import.tooLarge'));
      return;
    }
    const text = await file.text();
    setImportText(text);
    try {
      setImportTemplate(JSON.parse(text) as unknown);
    } catch {
      toast.error(t('settings.theme.import.invalidJson'));
    }
  };

  const parseImportText = () => {
    if (new TextEncoder().encode(importText).byteLength > MAX_THEME_TEMPLATE_BYTES) {
      toast.error(t('settings.theme.import.tooLarge'));
      return;
    }
    try {
      const template = JSON.parse(importText) as unknown;
      setImportTemplate(template);
      setImportPreview(undefined);
      previewImport.mutate({ template, apply: false });
    } catch {
      toast.error(t('settings.theme.import.invalidJson'));
    }
  };

  const setColor = (key: ThemeColorKey, value: string) => {
    change((current) => ({
      ...current,
      theme: {
        ...current.theme,
        colors: {
          ...current.theme.colors,
          [colorMode]: { ...current.theme.colors?.[colorMode], [key]: value },
        },
      },
    }));
  };

  const setThemePart = (section: 'layout' | 'components', key: string, value: string) => {
    change((current) => ({
      ...current,
      theme: {
        ...current.theme,
        [section]: { ...(current.theme[section] as Record<string, unknown> | undefined), [key]: value },
      } as NibleafThemeConfig,
    }));
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    if (contrastIssues.length > 0) {
      toast.error(t('settings.theme.contrastBlocked'));
      return;
    }
    updateConfig.mutate(
      { config: { theme: draft.theme, styling: { ...(project.config?.styling ?? {}), theme: draft.appearance } } },
      {
        onSuccess: () => {
          setHistory([]);
          toast.success(t('settings.theme.savedDraft'));
        },
        onError: () => toast.error(t('settings.saveError')),
      },
    );
  };

  return (
    <form onSubmit={save}>
      <SectionHeader icon="◈" title={t('settings.theme.title')} />
      <div className="mb-6 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm">
        <strong>{t('settings.theme.draftTitle')}</strong>
        <p className="mt-1 text-muted-foreground">{t('settings.theme.draftHint')}</p>
      </div>

      <Field hint={t('settings.theme.galleryHint')} label={t('settings.theme.gallery')}>
        <div className="grid gap-3 lg:grid-cols-3">
          {THEME_PRESET_IDS.map((presetId) => {
            const preset = THEME_PRESETS[presetId];
            const active = resolved.id === presetId;
            return (
              <button
                aria-pressed={active}
                className={cn(
                  'cursor-pointer rounded-xl border p-3 text-start outline-none transition focus-visible:ring-3 focus-visible:ring-ring/50',
                  active ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/45',
                )}
                key={presetId}
                onClick={() => change({ theme: fullPresetTheme(presetId), appearance: draft.appearance })}
                type="button"
              >
                <span className="mb-3 flex h-12 overflow-hidden rounded-lg border" aria-hidden>
                  <span className="w-1/3" style={{ background: preset.colors.light.muted }} />
                  <span className="flex-1" style={{ background: preset.colors.light.canvas }}>
                    <span className="m-2 block h-1.5 w-8 rounded-full" style={{ background: preset.colors.light.accent }} />
                  </span>
                </span>
                <strong>{preset.metadata.name}</strong>
                <span className="mt-1 block text-muted-foreground text-xs leading-relaxed">{preset.metadata.description}</span>
                <span className="mt-2 block text-[11px] text-primary">{preset.rationale}</span>
              </button>
            );
          })}
        </div>
      </Field>

      <Field hint={t('settings.theme.appearanceHint')} label={t('settings.theme.appearance')}>
        <Segmented
          className="max-w-[340px]"
          onChange={(appearance) => change((current) => ({ ...current, appearance }))}
          options={[
            { value: 'light', label: t('settings.styling.theme.light') },
            { value: 'dark', label: t('settings.styling.theme.dark') },
            { value: 'system', label: t('settings.styling.theme.system') },
          ]}
          value={draft.appearance}
        />
      </Field>

      <Field hint={t('settings.theme.layoutHint')} label={t('settings.theme.layout')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NativeSelect
            label={t('settings.theme.shell')}
            onChange={(v) => setThemePart('layout', 'shell', v)}
            options={['reference', 'editorial', 'console']}
            value={resolved.layout.shell}
          />
          <NativeSelect
            label={t('settings.theme.density')}
            onChange={(v) => setThemePart('layout', 'density', v)}
            options={['compact', 'comfortable', 'relaxed']}
            value={resolved.layout.density}
          />
          <NativeSelect
            label={t('settings.theme.contentWidth')}
            onChange={(v) => setThemePart('layout', 'contentWidth', v)}
            options={['focused', 'balanced', 'wide']}
            value={resolved.layout.contentWidth}
          />
          <NativeSelect
            label={t('settings.theme.header')}
            onChange={(v) => setThemePart('layout', 'header', v)}
            options={['inline', 'stacked', 'floating']}
            value={resolved.layout.header}
          />
          <NativeSelect
            label={t('settings.theme.sidebar')}
            onChange={(v) => setThemePart('layout', 'sidebar', v)}
            options={['bordered', 'soft', 'rail']}
            value={resolved.layout.sidebar}
          />
          <NativeSelect
            label={t('settings.theme.navigation')}
            onChange={(v) => setThemePart('layout', 'navigation', v)}
            options={['tree', 'sectioned', 'compact']}
            value={resolved.layout.navigation}
          />
          <NativeSelect
            label={t('settings.styling.radius.label')}
            onChange={(v) => setThemePart('layout', 'radius', v)}
            options={['sharp', 'rounded', 'pill']}
            value={resolved.layout.radius}
          />
        </div>
      </Field>

      <Field hint={t('settings.theme.componentsHint')} label={t('settings.theme.components')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <NativeSelect
            label={t('settings.theme.code')}
            onChange={(v) => setThemePart('components', 'codeBlocks', v)}
            options={['system', 'dim', 'vivid']}
            value={resolved.components.codeBlocks}
          />
          <NativeSelect
            label={t('settings.theme.callouts')}
            onChange={(v) => setThemePart('components', 'callouts', v)}
            options={['soft', 'outline', 'solid']}
            value={resolved.components.callouts}
          />
          <NativeSelect
            label={t('settings.theme.cards')}
            onChange={(v) => setThemePart('components', 'cards', v)}
            options={['bordered', 'lifted', 'flat']}
            value={resolved.components.cards}
          />
          <NativeSelect
            label={t('settings.theme.tabs')}
            onChange={(v) => setThemePart('components', 'tabs', v)}
            options={['underline', 'pills', 'boxed']}
            value={resolved.components.tabs}
          />
          <NativeSelect
            label={t('settings.theme.tables')}
            onChange={(v) => setThemePart('components', 'tables', v)}
            options={['lines', 'rows', 'cards']}
            value={resolved.components.tables}
          />
        </div>
      </Field>

      <Field hint={t('settings.theme.colorsHint')} label={t('settings.theme.colors')}>
        <Segmented
          className="mb-4 max-w-[220px]"
          onChange={setColorMode}
          options={[
            { value: 'light', label: t('settings.styling.theme.light') },
            { value: 'dark', label: t('settings.styling.theme.dark') },
          ]}
          value={colorMode}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COLOR_FIELDS.map((key) => (
            <label className="grid gap-1.5 text-[12.5px]" key={key}>
              <span className="font-medium">{t(`settings.theme.color.${key}`)}</span>
              <span className="flex items-center gap-2 rounded-md border border-input bg-background p-1.5">
                <input
                  aria-label={t(`settings.theme.color.${key}`)}
                  className="size-7 cursor-pointer border-0 bg-transparent p-0"
                  onChange={(event) => setColor(key, event.target.value)}
                  type="color"
                  value={resolved.colors[colorMode][key]}
                />
                <code className="text-xs">{resolved.colors[colorMode][key]}</code>
              </span>
            </label>
          ))}
        </div>
        {contrastIssues.length > 0 ? (
          <div className="mt-3 rounded-lg border border-destructive/35 bg-destructive/8 p-3 text-destructive text-xs" role="alert">
            <strong>{t('settings.theme.contrastTitle')}</strong>
            <ul className="mt-1 list-disc ps-5">
              {contrastIssues.map((issue) => (
                <li key={`${issue.mode}-${issue.pair}`}>{`${issue.mode}: ${issue.pair} ${issue.ratio.toFixed(2)}:1 < ${issue.required}:1`}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 text-success text-xs">{t('settings.theme.contrastPass')}</p>
        )}
      </Field>

      <Field hint={t('settings.theme.previewHint')} label={t('settings.theme.preview')}>
        <div className="mb-3 flex flex-wrap gap-2">
          <Segmented
            className="max-w-[220px]"
            onChange={setPreviewMode}
            options={[
              { value: 'light', label: t('settings.styling.theme.light') },
              { value: 'dark', label: t('settings.styling.theme.dark') },
            ]}
            value={previewMode}
          />
          <button
            className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm"
            onClick={() => setPreviewArabic((value) => !value)}
            type="button"
          >
            {previewArabic ? 'English · LTR' : 'العربية · RTL'}
          </button>
        </div>
        <ThemePreview arabic={previewArabic} config={config} mode={previewMode} />
      </Field>

      <div className="mb-8 flex flex-wrap items-center gap-2 border-border border-y py-4">
        <button
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={history.length === 0}
          onClick={() => {
            const previous = history.at(-1);
            if (previous) {
              setDraft(previous);
              setHistory((items) => items.slice(0, -1));
            }
          }}
          type="button"
        >
          <Undo2 className="size-4" /> {t('settings.theme.undo')}
        </button>
        <button
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasChanges}
          onClick={() => {
            setDraft(saved);
            setHistory([]);
          }}
          type="button"
        >
          {t('common.cancel')}
        </button>
        <button
          className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border px-3 text-sm"
          onClick={() => change({ theme: fullPresetTheme(resolved.id), appearance: draft.appearance })}
          type="button"
        >
          <RotateCcw className="size-4" /> {t('settings.theme.reset')}
        </button>
      </div>

      <Field hint={t('settings.theme.exchangeHint')} label={t('settings.theme.exchange')}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border p-4">
            <FileJson className="size-5 text-primary" />
            <h3 className="mt-3 font-semibold">{t('settings.theme.exportTitle')}</h3>
            <p className="mt-1 text-muted-foreground text-xs">{t('settings.theme.exportHint')}</p>
            <button
              className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground text-sm disabled:opacity-50"
              disabled={exportTheme.isPending}
              onClick={() => exportTheme.mutate()}
              type="button"
            >
              <Download className="size-4" /> {t('settings.theme.export')}
            </button>
          </div>
          <div className="rounded-xl border border-border p-4">
            <Upload className="size-5 text-primary" />
            <h3 className="mt-3 font-semibold">{t('settings.theme.importTitle')}</h3>
            <p className="mt-1 text-muted-foreground text-xs">{t('settings.theme.importHint')}</p>
            <input accept="application/json,.json" className="sr-only" onChange={handleFile} ref={fileInput} type="file" />
            <button
              className="mt-3 h-9 cursor-pointer rounded-md border border-border px-3 text-sm"
              onClick={() => fileInput.current?.click()}
              type="button"
            >
              {t('settings.theme.chooseFile')}
            </button>
          </div>
        </div>
        <textarea
          aria-label={t('settings.theme.importJson')}
          className="mt-4 min-h-32 w-full rounded-lg border border-input bg-background p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          onChange={(event) => {
            setImportText(event.target.value);
            setImportTemplate(undefined);
            setImportPreview(undefined);
          }}
          placeholder={t('settings.theme.importPlaceholder')}
          value={importText}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Segmented
            className="max-w-[260px]"
            onChange={(mode) => {
              setImportMode(mode);
              setImportPreview(undefined);
            }}
            options={[
              { value: 'merge', label: t('settings.theme.merge') },
              { value: 'replace', label: t('settings.theme.replace') },
            ]}
            value={importMode}
          />
          <button
            className="h-9 cursor-pointer rounded-md border border-border px-3 text-sm disabled:opacity-50"
            disabled={!importText.trim() || previewImport.isPending}
            onClick={parseImportText}
            type="button"
          >
            {t('settings.theme.previewImport')}
          </button>
        </div>
        {importPreview ? (
          <div className="mt-4 rounded-xl border border-border bg-muted/25 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{t('settings.theme.importChanges', { count: importPreview.changes.length })}</strong>
              {importPreview.migratedFrom === 0 ? <span className="rounded-full bg-primary/10 px-2 py-1 text-primary text-xs">v0 → v1</span> : null}
            </div>
            <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-border bg-background">
              {importPreview.changes.length === 0 ? (
                <p className="p-3 text-muted-foreground text-xs">{t('settings.theme.noChanges')}</p>
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {importPreview.changes.slice(0, 100).map((item) => (
                    <li className="grid gap-1 p-3" key={item.path}>
                      <code className="font-semibold text-primary">{item.path}</code>
                      <span className="break-all text-muted-foreground">
                        {valueLabel(item.before)} → {valueLabel(item.after)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button
              className="mt-3 h-9 cursor-pointer rounded-md bg-primary px-3 font-medium text-primary-foreground text-sm disabled:opacity-50"
              disabled={!importTemplate || importPreview.changes.length === 0 || previewImport.isPending}
              onClick={() => importTemplate && previewImport.mutate({ template: importTemplate, apply: true })}
              type="button"
            >
              {t('settings.theme.applyImport')}
            </button>
          </div>
        ) : null}
      </Field>

      <SaveBar isSubmitting={updateConfig.isPending} />
    </form>
  );
}
