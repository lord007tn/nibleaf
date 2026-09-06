import { Button } from '@nibleaf/design-system/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@nibleaf/design-system/components/ui/collapsible';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { ghostImportBody } from '@nibleaf/validators';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, ChevronDown, DownloadCloud, Ghost, GitBranch, Leaf, Loader2, Upload } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type ContentImportSummary, useImportFromGhost, useImportFromMintlify } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { SettingsSection } from './section';

/** Matches the server-side body cap for Ghost exports. */
const MAX_GHOST_FILE_BYTES = 15 * 1024 * 1024;
type ImportSource = 'mintlify' | 'ghost';

const IMPORT_SOURCE_TABS = [
  { id: 'mintlify', icon: Leaf, label: 'settings.import.mintlify.title' },
  { id: 'ghost', icon: Ghost, label: 'settings.import.ghost.title' },
  { id: 'git', icon: GitBranch, label: 'settings.import.git.title' },
] as const;

class ImportFileReadError extends Error {
  readonly code = 'import:file_read';

  constructor() {
    super('import:file_read');
    this.name = 'ImportFileReadError';
  }
}

const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new ImportFileReadError());
    reader.readAsText(file);
  });

const normalizeGithubRepo = (value: string): string =>
  value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

const isValidHttpUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
};

function ImportResult({ summary, projectId }: { summary: ContentImportSummary; projectId?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [showWarnings, setShowWarnings] = useState(false);
  const warnings = [...new Set(summary.warnings)];
  return (
    <div className="flex min-h-[220px] flex-col justify-center rounded-2xl bg-muted/25 p-5 text-sm">
      <div className="mx-auto w-full max-w-md rounded-xl border border-border bg-background p-4 shadow-sm">
        <p className="font-medium">
          {t('settings.import.result', { imported: summary.imported, updated: summary.updated, skipped: summary.skipped })}
        </p>
        {summary.assetsImported !== undefined ? (
          <p className="mt-1.5 text-muted-foreground text-xs">
            {t('settings.import.assetsResult', { imported: summary.assetsImported, skipped: summary.assetsSkipped ?? 0 })}
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <>
            <Button
              aria-expanded={showWarnings}
              className="mt-3 h-auto gap-1 p-0 text-muted-foreground text-xs hover:text-foreground"
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
                {warnings.map((warning) => (
                  <li dir="auto" key={warning}>
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
        <p className="mt-3 text-muted-foreground text-xs leading-relaxed">{t('settings.import.publishHint')}</p>
        {projectId ? (
          <Button
            className="mt-3"
            onClick={() => navigate({ to: '/app/projects/$projectId/editor', params: { projectId } })}
            size="sm"
            type="button"
            variant="outline"
          >
            {t('settings.import.openEditor')} <ArrowUpRight className="size-3.5 rtl:-scale-x-100" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function SourceChip({ active, icon, label, onClick }: { active?: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <Button
      aria-pressed={active}
      className={cn('rounded-lg text-xs', active ? 'shadow-sm' : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground')}
      onClick={onClick}
      size="sm"
      type="button"
      variant={active ? 'default' : 'secondary'}
    >
      {icon}
      {label}
    </Button>
  );
}

export function ImportTab({ projectId }: { projectId?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const mintlify = useImportFromMintlify(projectId ?? '');
  const ghost = useImportFromGhost(projectId ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<ImportSource | null>(null);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [ghostUrl, setGhostUrl] = useState('');
  const [ghostFile, setGhostFile] = useState<File | null>(null);
  const [result, setResult] = useState<ContentImportSummary | null>(null);

  const pending = mintlify.isPending || ghost.isPending;
  const chooseSource = (next: ImportSource) => {
    setSource(next);
    setResult(null);
  };
  const openGitSettings = () =>
    navigate({ to: '/app/projects/$projectId/settings', params: { projectId: projectId ?? '' }, search: { section: 'git' } });
  const handleSuccess = (summary: ContentImportSummary) => {
    setResult(summary);
    toast.success(t('settings.import.success'));
  };
  const handleError = (error: unknown) => {
    if (error instanceof ApiResponseError && error.code === 'import:invalid_document') {
      toast.error(source === 'ghost' ? t('settings.import.ghost.invalidJson') : t('settings.import.error'));
      return;
    }
    if (error instanceof ImportFileReadError) {
      toast.error(t('settings.import.error'));
      return;
    }
    toast.error(error instanceof Error ? error.message : t('settings.import.error'));
  };

  const runImport = async () => {
    if (source === 'mintlify') {
      const normalizedRepo = normalizeGithubRepo(repo);
      if (!/^[\w.-]+\/[\w.-]+$/.test(normalizedRepo)) {
        toast.error(t('settings.import.mintlify.invalidRepo'));
        return;
      }
      const trimmedBranch = branch.trim();
      mintlify.mutate(
        { repo: normalizedRepo, ...(trimmedBranch ? { branch: trimmedBranch } : {}), replaceExisting },
        { onSuccess: handleSuccess, onError: handleError },
      );
      return;
    }
    if (source !== 'ghost' || !ghostFile) return;
    if (!isValidHttpUrl(ghostUrl.trim())) {
      toast.error(t('settings.import.ghost.invalidUrl'));
      return;
    }
    if (ghostFile.size > MAX_GHOST_FILE_BYTES) {
      toast.error(t('settings.import.ghost.tooLarge'));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFileText(ghostFile));
    } catch {
      toast.error(t('settings.import.ghost.invalidJson'));
      return;
    }
    const document = ghostImportBody.safeParse(parsed);
    if (!document.success) {
      toast.error(t('settings.import.ghost.invalidJson'));
      return;
    }
    ghost.mutate({ ...document.data, __nibleafImport: { ghostUrl: ghostUrl.trim() } }, { onSuccess: handleSuccess, onError: handleError });
  };

  const canImport =
    Boolean(projectId) &&
    !pending &&
    ((source === 'mintlify' && Boolean(repo.trim())) || (source === 'ghost' && Boolean(ghostFile && ghostUrl.trim())));

  return (
    <SettingsSection description={t('settings.import.description')} title={t('settings.import.title')}>
      <div className="w-full py-2">
        <div className="mb-5 text-center">
          <h3 className="font-semibold text-base tracking-tight">{t('settings.import.workspace.title')}</h3>
          <p className="mx-auto mt-1 max-w-lg text-muted-foreground text-sm">{t('settings.import.workspace.description')}</p>
        </div>

        <div className="rounded-[20px] border border-border bg-card p-2 shadow-sm">
          {result ? (
            <ImportResult projectId={projectId} summary={result} />
          ) : (
            <div className="min-h-[220px] rounded-2xl bg-muted/20 p-4 sm:p-5">
              {!source ? (
                <div className="flex min-h-[180px] flex-col items-center justify-center text-center">
                  <DownloadCloud className="mb-3 size-7 text-muted-foreground" />
                  <p className="font-medium text-sm">{t('settings.import.workspace.emptyTitle')}</p>
                  <p className="mt-1 max-w-sm text-muted-foreground text-xs leading-relaxed">{t('settings.import.workspace.emptyDescription')}</p>
                </div>
              ) : null}

              {source === 'mintlify' ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Leaf className="size-4" />
                      </span>
                      <div>
                        <p className="font-medium text-sm">{t('settings.import.mintlify.title')}</p>
                        <p className="text-muted-foreground text-xs">{t('settings.import.mintlify.description')}</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="import-mintlify-repo">{t('settings.import.mintlify.repo')}</Label>
                      <Input
                        className="bg-background font-mono"
                        dir="ltr"
                        id="import-mintlify-repo"
                        onChange={(event) => setRepo(event.target.value)}
                        placeholder="github.com/acme/docs"
                        value={repo}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="import-mintlify-branch">{t('settings.import.mintlify.branch')}</Label>
                      <Input
                        className="bg-background font-mono"
                        dir="ltr"
                        id="import-mintlify-branch"
                        onChange={(event) => setBranch(event.target.value)}
                        placeholder="main"
                        value={branch}
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-background px-3 py-2.5">
                    <Label className="leading-snug" htmlFor="import-mintlify-replace">
                      {t('settings.import.mintlify.replaceExisting')}
                    </Label>
                    <Switch checked={replaceExisting} id="import-mintlify-replace" onCheckedChange={setReplaceExisting} />
                  </div>
                </div>
              ) : null}

              {source === 'ghost' ? (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2">
                    <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary">
                      <Ghost className="size-4" />
                    </span>
                    <div>
                      <p className="font-medium text-sm">{t('settings.import.ghost.title')}</p>
                      <p className="text-muted-foreground text-xs">{t('settings.import.ghost.description')}</p>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="import-ghost-url">{t('settings.import.ghost.url')}</Label>
                    <Input
                      className="bg-background"
                      dir="ltr"
                      id="import-ghost-url"
                      onChange={(event) => setGhostUrl(event.target.value)}
                      placeholder="https://ghost.example.com"
                      type="url"
                      value={ghostUrl}
                    />
                    <p className="text-muted-foreground text-xs">{t('settings.import.ghost.urlHint')}</p>
                  </div>
                  <input
                    accept=".json,application/json"
                    aria-label={t('settings.import.ghost.file')}
                    className="sr-only"
                    id="import-ghost-file"
                    onChange={(event) => setGhostFile(event.target.files?.[0] ?? null)}
                    ref={fileInputRef}
                    type="file"
                  />
                  <Button
                    className="h-auto min-h-14 w-full justify-start gap-3 whitespace-normal rounded-xl px-3 py-2.5 text-start font-normal"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                    variant="outline"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <Upload className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-sm">{ghostFile?.name ?? t('settings.import.ghost.file')}</span>
                      <span className="block text-muted-foreground text-xs">{t('settings.import.ghost.fileHint')}</span>
                    </span>
                  </Button>
                  <Collapsible className="rounded-xl border border-border bg-background px-3 py-2.5 text-xs leading-relaxed">
                    <CollapsibleTrigger className="cursor-pointer font-medium text-foreground">
                      {t('settings.import.ghost.languageTitle')}
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="mt-2 text-muted-foreground">{t('settings.import.ghost.languageTutorial')}</p>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              ) : null}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 px-1 pt-2">
            {IMPORT_SOURCE_TABS.map((tab) => (
              <SourceChip
                active={tab.id !== 'git' && source === tab.id && !result}
                icon={<tab.icon className="size-3.5" />}
                key={tab.id}
                label={t(tab.label)}
                onClick={() => (tab.id === 'git' ? openGitSettings() : chooseSource(tab.id))}
              />
            ))}
            {result ? (
              <Button className="ms-auto" onClick={() => setResult(null)} size="sm" type="button" variant="outline">
                {t('settings.import.again')}
              </Button>
            ) : source ? (
              <Button className="ms-auto" disabled={!canImport} onClick={runImport} size="sm" type="button">
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <DownloadCloud className="size-3.5" />}
                {pending ? t('settings.import.running') : t('settings.import.run')}
              </Button>
            ) : null}
          </div>
        </div>
        <p className="mx-auto mt-3 max-w-lg text-center text-muted-foreground text-xs leading-relaxed">{t('settings.import.summaryHint')}</p>
      </div>
    </SettingsSection>
  );
}
