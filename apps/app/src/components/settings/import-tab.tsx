import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@nibleaf/design-system/components/ui/collapsible';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { RadioField, RadioGroup } from '@nibleaf/design-system/components/ui/radio-group';
import { SettingsSection, SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, BookOpen, ChevronDown, DownloadCloud, Ghost, GitBranch, Leaf, Upload } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { useGhostImportCommand } from '@/features/site-import/components/use-ghost-import';
import { useRepositoryImportCommand } from '@/features/site-import/components/use-repository-import';
import { isRepositoryImportProvider, type RepositoryImportProvider } from '@/features/site-import/model/repository-import';
import type { ContentImportSummary } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { importMayStillRun } from './import-errors';

type ImportSource = RepositoryImportProvider | 'ghost' | 'git';
const isRepoSource = (source: ImportSource | null): source is RepositoryImportProvider => isRepositoryImportProvider(source);

/** Where the content lives now: the first thing the page asks (AUTH-24). */
const IMPORT_SOURCES = [
  { id: 'mintlify', icon: Leaf, label: 'settings.import.mintlify.title', description: 'settings.import.source.mintlify' },
  { id: 'gitbook', icon: BookOpen, label: 'settings.import.gitbook.title', description: 'settings.import.source.gitbook' },
  { id: 'ghost', icon: Ghost, label: 'settings.import.ghost.title', description: 'settings.import.source.ghost' },
  { id: 'git', icon: GitBranch, label: 'settings.import.git.title', description: 'settings.import.source.git' },
] as const satisfies ReadonlyArray<{ id: ImportSource; icon: typeof Leaf; label: MessageKey; description: MessageKey }>;

type FieldName = 'repo' | 'sourceUrl' | 'ghostUrl' | 'ghostFile';
/** Refusals that belong to one field: shown under it, never as a toast. */
const REFUSAL_FIELDS: Partial<Record<MessageKey, { field: FieldName; message: MessageKey }>> = {
  'settings.import.mintlify.invalidRepo': { field: 'repo', message: 'settings.import.mintlify.invalidRepo' },
  'settings.import.sourceUrl': { field: 'sourceUrl', message: 'settings.import.invalidSourceUrl' },
  'settings.import.ghost.invalidUrl': { field: 'ghostUrl', message: 'settings.import.ghost.invalidUrl' },
  'settings.import.ghost.tooLarge': { field: 'ghostFile', message: 'settings.import.ghost.tooLarge' },
  'settings.import.ghost.invalidJson': { field: 'ghostFile', message: 'settings.import.ghost.invalidJson' },
};
const FIELD_IDS: Record<FieldName, string> = {
  repo: 'import-repo',
  sourceUrl: 'import-source-url',
  ghostUrl: 'import-ghost-url',
  ghostFile: 'import-ghost-file-button',
};

function ImportResult({ summary, projectId, onAgain }: { summary: ContentImportSummary; projectId?: string; onAgain: () => void }) {
  const t = useT();
  const [showWarnings, setShowWarnings] = useState(false);
  const warnings = [
    ...new Set(summary.warnings),
    ...(summary.fidelityIssues ?? []).map((issue) =>
      t(issue.kind === 'embed' ? 'settings.import.unmappedEmbed' : 'settings.import.unresolvedLink', {
        page: issue.page,
        reference: issue.reference,
      }),
    ),
  ];
  const occurrences = new Map<string, number>();
  const rows = warnings.map((text) => {
    const occurrence = (occurrences.get(text) ?? 0) + 1;
    occurrences.set(text, occurrence);
    return { text, key: `${text}-${occurrence}` };
  });
  return (
    <SettingsSection data-slot="import-result" title={t('settings.import.success')}>
      <SettingsSectionBody className="flex flex-col gap-3 text-sm" role="status">
        <p className="font-medium">
          {t('settings.import.result', { imported: summary.imported, updated: summary.updated, skipped: summary.skipped })}
        </p>
        {summary.assetsImported !== undefined ? (
          <p className="text-muted-foreground">
            {t('settings.import.assetsResult', { imported: summary.assetsImported, skipped: summary.assetsSkipped ?? 0 })}
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <div>
            <Button
              aria-expanded={showWarnings}
              className="h-auto gap-1 p-0 text-muted-foreground hover:text-foreground"
              onClick={() => setShowWarnings((value) => !value)}
              size="sm"
              type="button"
              variant="link"
            >
              <ChevronDown className={cn('size-3.5 transition-transform', !showWarnings && '-rotate-90 rtl:rotate-90')} />
              {showWarnings ? t('settings.import.warnings.hide') : t('settings.import.warnings.show', { count: warnings.length })}
            </Button>
            {showWarnings ? (
              <ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground text-xs">
                {rows.map((row) => (
                  <li dir="auto" key={row.key}>
                    {row.text}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <Callout tone="info">{t('settings.import.publishHint')}</Callout>
        <div className="flex flex-wrap gap-2">
          {projectId ? (
            <Button nativeButton={false} render={<Link params={{ projectId }} to="/app/projects/$projectId/editor" />} type="button">
              {t('settings.import.openEditor')} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
            </Button>
          ) : null}
          <Button onClick={onAgain} type="button" variant="outline">
            {t('settings.import.again')}
          </Button>
        </div>
      </SettingsSectionBody>
    </SettingsSection>
  );
}

/** A labelled field with its hint and, after a refused press, its error. */
function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (describedBy: string | undefined) => ReactNode;
  className?: string;
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children(describedBy)}
      {hint ? (
        <p className="text-muted-foreground text-xs" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
      <FieldError errors={error ? [error] : []} id={`${id}-error`} />
    </div>
  );
}

/**
 * Settings → Import (AUTH-24): the page first asks where the content lives
 * now, then shows only that source's fields, with Import at the end of them.
 */
export function ImportTab({ projectId }: { projectId?: string }) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [spacePath, setSpacePath] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [ghostUrl, setGhostUrl] = useState('');
  const [ghostFile, setGhostFile] = useState<File | null>(null);
  const [result, setResult] = useState<ContentImportSummary | null>(null);
  const [errors, setErrors] = useState<Partial<Record<FieldName, MessageKey>>>({});
  const repository = useRepositoryImportCommand({ projectId: projectId ?? '', provider: isRepoSource(source) ? source : null });
  const ghost = useGhostImportCommand({ projectId: projectId ?? '', open: source === 'ghost', file: ghostFile, ghostUrl });

  const pending = repository.busy || ghost.busy;
  const pageRef = useRef<HTMLDivElement>(null);
  const showingResult = result !== null;
  const shownResult = useRef(showingResult);
  useEffect(() => {
    if (shownResult.current === showingResult) return;
    shownResult.current = showingResult;
    // The button that was pressed (Import, or Import another) is gone: start at the heading of what replaced it.
    const heading = pageRef.current?.querySelector<HTMLElement>(showingResult ? '[data-slot="import-result"] h2' : '[data-slot="import-picker"] h2');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus();
  }, [showingResult]);
  const clearError = (field: FieldName) => setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  const chooseSource = (next: ImportSource) => {
    setSource(next);
    setResult(null);
    setErrors({});
  };
  /** A refusal tied to a field shows under it and takes focus there; anything else is a toast. */
  const refused = (message: MessageKey) => {
    const target = REFUSAL_FIELDS[message];
    if (!target) {
      toast.error(t(message));
      return;
    }
    // Rendered before focus moves, so the field is announced with its error.
    flushSync(() => setErrors((current) => ({ ...current, [target.field]: target.message })));
    document.getElementById(FIELD_IDS[target.field])?.focus();
  };
  const handleSuccess = (summary: ContentImportSummary) => {
    setErrors({});
    setResult(summary);
    toast.success(t('settings.import.success'));
  };
  const handleError = (error: unknown) => {
    if (error instanceof ApiResponseError) {
      if (error.code === 'import:in_progress') {
        toast.error(t('settings.import.inProgress'));
        return;
      }
      if (error.code === 'import:busy') {
        toast.error(t('settings.import.busy'));
        return;
      }
      if (error.code === 'import:incomplete') {
        toast.error(`${t('settings.import.incomplete')}${error.path ? ` (${error.sourceFile ? `${error.sourceFile}: ` : ''}${error.path})` : ''}`);
        return;
      }
      if (error.code === 'import:limit') {
        toast.error(error.limit === undefined ? t('settings.import.limit') : t('settings.import.nodeLimit', { limit: error.limit }));
        return;
      }
      if (error.status === 409) {
        toast.error(t('settings.import.conflict'));
        return;
      }
    }
    if (importMayStillRun(error)) {
      toast.error(t('settings.import.mayStillRun'), { duration: 20_000 });
      return;
    }
    if (error instanceof ApiResponseError && error.code === 'import:invalid_document') {
      if (source === 'ghost') refused('settings.import.ghost.invalidJson');
      else toast.error(t('settings.import.error'));
      return;
    }
    toast.error(t('settings.import.error'));
  };

  const runImport = () => {
    if (!projectId) return;
    if (isRepoSource(source)) {
      // One owner sends what the form holds now (replaceExisting included), and reports only into the panel it started in.
      repository.start({ repo, branch, sourceUrl, path: spacePath, replaceExisting }, { refused, succeeded: handleSuccess, failed: handleError });
      return;
    }
    if (source !== 'ghost') return;
    if (!ghostFile) {
      flushSync(() => setErrors((current) => ({ ...current, ghostFile: 'settings.import.ghost.fileRequired' })));
      document.getElementById(FIELD_IDS.ghostFile)?.focus();
      return;
    }
    // One owner reads, checks and sends the file, and reports only into the panel it started in.
    ghost.start({ refused, succeeded: handleSuccess, failed: handleError });
  };
  const errorOf = (field: FieldName) => (errors[field] ? t(errors[field]) : undefined);

  const importButton = (
    <Button
      // Busy keeps focus on the button, so a keyboard press doesn't drop it to the page.
      focusableWhenDisabled={pending}
      loading={pending}
      loadingText={t('settings.import.running')}
      onClick={runImport}
      type="button"
    >
      <DownloadCloud className="size-4" />
      {t('settings.import.run')}
    </Button>
  );

  return (
    <div className="flex min-w-0 flex-col gap-8" ref={pageRef}>
      <PageHeader description={t('settings.import.description')} title={t('settings.import.title')} />
      {result ? (
        <ImportResult onAgain={() => setResult(null)} projectId={projectId} summary={result} />
      ) : (
        <>
          <SettingsSection data-slot="import-picker" title={t('settings.import.workspace.emptyTitle')}>
            <SettingsSectionBody>
              <RadioGroup
                aria-label={t('settings.import.workspace.emptyTitle')}
                className="grid gap-3 sm:grid-cols-2"
                onValueChange={(value) => chooseSource(value as ImportSource)}
                value={source ?? ''}
              >
                {IMPORT_SOURCES.map((choice) => (
                  <RadioField
                    className={cn(
                      'min-w-0 rounded-lg border border-border px-3 py-3 transition-colors',
                      'has-data-checked:border-primary/60 has-data-checked:bg-primary/5 not-has-data-checked:hover:bg-muted/50',
                    )}
                    description={t(choice.description)}
                    key={choice.id}
                    label={
                      <span className="inline-flex items-center gap-2">
                        <choice.icon aria-hidden className="size-4 text-muted-foreground" />
                        {t(choice.label)}
                      </span>
                    }
                    value={choice.id}
                  />
                ))}
              </RadioGroup>
            </SettingsSectionBody>
          </SettingsSection>

          {source === 'git' ? (
            <SettingsSection description={t('settings.import.git.description')} title={t('settings.import.git.title')}>
              <SettingsSectionBody>
                {projectId ? (
                  <Button
                    nativeButton={false}
                    render={<Link params={{ projectId }} search={{ section: 'git' }} to="/app/projects/$projectId/settings" />}
                  >
                    <GitBranch className="size-4" />
                    {t('settings.import.git.open')}
                  </Button>
                ) : null}
              </SettingsSectionBody>
            </SettingsSection>
          ) : null}

          {isRepoSource(source) ? (
            <SettingsSection
              description={t(`settings.import.${source}.description`)}
              footer={<p className="text-xs leading-relaxed">{t('settings.import.summaryHint')}</p>}
              title={t(`settings.import.${source}.title`)}
            >
              <SettingsSectionBody className="flex flex-col gap-4">
                <Field error={errorOf('repo')} id="import-repo" label={t('settings.import.mintlify.repo')}>
                  {(describedBy) => (
                    <Input
                      aria-describedby={describedBy}
                      aria-invalid={errors.repo ? true : undefined}
                      className="font-mono"
                      dir="ltr"
                      id="import-repo"
                      onChange={(event) => {
                        setRepo(event.target.value);
                        clearError('repo');
                      }}
                      placeholder="github.com/acme/docs"
                      value={repo}
                    />
                  )}
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="import-branch" label={t('settings.import.mintlify.branch')}>
                    {(describedBy) => (
                      <Input
                        aria-describedby={describedBy}
                        className="font-mono"
                        dir="ltr"
                        id="import-branch"
                        onChange={(event) => setBranch(event.target.value)}
                        placeholder="main"
                        value={branch}
                      />
                    )}
                  </Field>
                  <Field error={errorOf('sourceUrl')} id="import-source-url" label={t('settings.import.sourceUrl')}>
                    {(describedBy) => (
                      <Input
                        aria-describedby={describedBy}
                        aria-invalid={errors.sourceUrl ? true : undefined}
                        dir="ltr"
                        disabled={pending}
                        id="import-source-url"
                        onChange={(event) => {
                          setSourceUrl(event.target.value);
                          clearError('sourceUrl');
                        }}
                        placeholder="https://help.example.com"
                        type="url"
                        value={sourceUrl}
                      />
                    )}
                  </Field>
                </div>
                {source === 'gitbook' ? (
                  <Field hint={t('settings.import.gitbook.pathHint')} id="import-gitbook-path" label={t('settings.import.gitbook.path')}>
                    {(describedBy) => (
                      <Input
                        aria-describedby={describedBy}
                        className="font-mono"
                        dir="ltr"
                        id="import-gitbook-path"
                        onChange={(event) => setSpacePath(event.target.value)}
                        placeholder="docs"
                        value={spacePath}
                      />
                    )}
                  </Field>
                ) : null}
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
                  <Label className="leading-snug" htmlFor="import-replace">
                    {t('settings.import.mintlify.replaceExisting')}
                  </Label>
                  <Switch checked={replaceExisting} id="import-replace" onCheckedChange={setReplaceExisting} />
                </div>
                <div className="flex justify-end">{importButton}</div>
              </SettingsSectionBody>
            </SettingsSection>
          ) : null}

          {source === 'ghost' ? (
            <SettingsSection
              description={t('settings.import.ghost.description')}
              footer={<p className="text-xs leading-relaxed">{t('settings.import.summaryHint')}</p>}
              title={t('settings.import.ghost.title')}
            >
              <SettingsSectionBody className="flex flex-col gap-4">
                <Field
                  error={errorOf('ghostUrl')}
                  hint={t('settings.import.ghost.urlHint')}
                  id="import-ghost-url"
                  label={t('settings.import.ghost.url')}
                >
                  {(describedBy) => (
                    <Input
                      aria-describedby={describedBy}
                      aria-invalid={errors.ghostUrl ? true : undefined}
                      dir="ltr"
                      id="import-ghost-url"
                      onChange={(event) => {
                        setGhostUrl(event.target.value);
                        clearError('ghostUrl');
                      }}
                      placeholder="https://ghost.example.com"
                      type="url"
                      value={ghostUrl}
                    />
                  )}
                </Field>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <input
                    accept=".json,application/json"
                    aria-label={t('settings.import.ghost.file')}
                    className="sr-only"
                    id="import-ghost-file"
                    onChange={(event) => {
                      setGhostFile(event.target.files?.[0] ?? null);
                      clearError('ghostFile');
                    }}
                    ref={fileInputRef}
                    tabIndex={-1}
                    type="file"
                  />
                  <Button
                    aria-describedby={errors.ghostFile ? 'import-ghost-file-error' : undefined}
                    aria-invalid={errors.ghostFile ? true : undefined}
                    className="h-auto min-h-14 w-full justify-start gap-3 whitespace-normal px-3 py-2.5 text-start font-normal"
                    id="import-ghost-file-button"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                    variant="outline"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <Upload className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block break-words font-medium text-sm" dir="auto">
                        {ghostFile?.name ?? t('settings.import.ghost.file')}
                      </span>
                      <span className="block text-muted-foreground text-xs">{t('settings.import.ghost.fileHint')}</span>
                    </span>
                  </Button>
                  <FieldError errors={errors.ghostFile ? [t(errors.ghostFile)] : []} id="import-ghost-file-error" />
                </div>
                <Collapsible className="rounded-lg border border-border px-3 py-2.5 text-sm leading-relaxed">
                  <CollapsibleTrigger className="cursor-pointer font-medium text-foreground">
                    {t('settings.import.ghost.languageTitle')}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="mt-2 text-muted-foreground">{t('settings.import.ghost.languageTutorial')}</p>
                  </CollapsibleContent>
                </Collapsible>
                <div className="flex justify-end">{importButton}</div>
              </SettingsSectionBody>
            </SettingsSection>
          ) : null}
        </>
      )}
    </div>
  );
}
