import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, ChevronDown, DownloadCloud, Ghost, GitBranch, Leaf, Loader2, Upload } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { toast } from 'sonner';
import { type ContentImportSummary, useImportFromGhost, useImportFromMintlify } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { SettingsSection } from './section';

/** Matches the server-side body cap for Ghost exports. */
const MAX_GHOST_FILE_BYTES = 15 * 1024 * 1024;
type ImportSource = 'mintlify' | 'ghost';

const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
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
            <button
              className="mt-3 flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => setShowWarnings((value) => !value)}
              type="button"
            >
              <ChevronDown className={cn('size-3.5 transition-transform', !showWarnings && '-rotate-90 rtl:rotate-90')} />
              {showWarnings ? t('settings.import.warnings.hide') : t('settings.import.warnings.show', { count: warnings.length })}
            </button>
            {showWarnings ? (
              <ul className="mt-2 list-disc space-y-1 ps-5 text-muted-foreground text-xs">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
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
    <button
      className={cn(
        'flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 font-medium text-xs transition-colors',
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
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
  const handleError = (error: unknown) => toast.error(error instanceof Error ? error.message : t('settings.import.error'));

  const runImport = async () => {
    if (source === 'mintlify') {
      const normalizedRepo = normalizeGithubRepo(repo);
      if (!/^[\w.-]+\/[\w.-]+$/.test(normalizedRepo)) {
        toast.error(t('settings.import.mintlify.invalidRepo'));
        return;
      }
      const trimmedBranch = branch.trim();
      mintlify.mutate(
        { repo: normalizedRepo, ...(trimmedBranch ? { branch: trimmedBranch } : {}) },
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
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      toast.error(t('settings.import.ghost.invalidJson'));
      return;
    }
    ghost.mutate(
      { ...(parsed as Record<string, unknown>), __nibleafImport: { ghostUrl: ghostUrl.trim() } },
      { onSuccess: handleSuccess, onError: handleError },
    );
  };

  const canImport =
    Boolean(projectId) &&
    !pending &&
    ((source === 'mintlify' && Boolean(repo.trim())) || (source === 'ghost' && Boolean(ghostFile && ghostUrl.trim())));

  return (
    <SettingsSection description={t('settings.import.description')} title={t('settings.import.title')}>
      <div className="mx-auto w-full max-w-2xl py-2">
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
                <div className="mx-auto flex max-w-lg flex-col gap-4">
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
                        id="import-mintlify-branch"
                        onChange={(event) => setBranch(event.target.value)}
                        placeholder="main"
                        value={branch}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {source === 'ghost' ? (
                <div className="mx-auto flex max-w-lg flex-col gap-4">
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
                    className="sr-only"
                    onChange={(event) => setGhostFile(event.target.files?.[0] ?? null)}
                    ref={fileInputRef}
                    type="file"
                  />
                  <button
                    className="flex min-h-14 items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5 text-start hover:bg-muted/35"
                    onClick={() => fileInputRef.current?.click()}
                    type="button"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <Upload className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-sm">{ghostFile?.name ?? t('settings.import.ghost.file')}</span>
                      <span className="block text-muted-foreground text-xs">{t('settings.import.ghost.fileHint')}</span>
                    </span>
                  </button>
                  <details className="rounded-xl border border-border bg-background px-3 py-2.5 text-xs leading-relaxed">
                    <summary className="cursor-pointer font-medium text-foreground">{t('settings.import.ghost.languageTitle')}</summary>
                    <p className="mt-2 text-muted-foreground">{t('settings.import.ghost.languageTutorial')}</p>
                  </details>
                </div>
              ) : null}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2 px-1 pt-2">
            <SourceChip
              active={source === 'mintlify' && !result}
              icon={<Leaf className="size-3.5" />}
              label={t('settings.import.mintlify.title')}
              onClick={() => chooseSource('mintlify')}
            />
            <SourceChip
              active={source === 'ghost' && !result}
              icon={<Ghost className="size-3.5" />}
              label={t('settings.import.ghost.title')}
              onClick={() => chooseSource('ghost')}
            />
            <SourceChip icon={<GitBranch className="size-3.5" />} label={t('settings.import.git.title')} onClick={openGitSettings} />
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
