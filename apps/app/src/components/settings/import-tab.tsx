import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, ChevronDown, DownloadCloud, Ghost, GitBranch, Leaf, Loader2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { type ContentImportSummary, useImportFromGhost, useImportFromMintlify } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { SettingsSection } from './section';

/** Matches the server-side body cap for Ghost exports. */
const MAX_GHOST_FILE_BYTES = 15 * 1024 * 1024;

const readFileText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.readAsText(file);
  });

/** Counts + collapsible warning list for one finished import, plus a reminder
 *  that imported content only goes live once published from the editor. */
function ImportResult({ summary, projectId }: { summary: ContentImportSummary; projectId?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const [showWarnings, setShowWarnings] = useState(false);
  const warnings = [...new Set(summary.warnings)];
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
      <p>{t('settings.import.result', { imported: summary.imported, updated: summary.updated, skipped: summary.skipped })}</p>
      {warnings.length > 0 ? (
        <>
          <button
            className="mt-2 flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
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
      <p className="mt-2 text-muted-foreground text-xs leading-relaxed">{t('settings.import.publishHint')}</p>
      {projectId ? (
        <Button
          className="mt-2"
          onClick={() => navigate({ to: '/app/projects/$projectId/editor', params: { projectId } })}
          size="sm"
          type="button"
          variant="outline"
        >
          {t('settings.import.openEditor')} <ArrowUpRight className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}

function SourceCard({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/40 text-muted-foreground">{icon}</span>
        <div className="font-medium text-sm">{title}</div>
      </div>
      <p className="mt-2 text-muted-foreground text-xs leading-relaxed">{description}</p>
      <div className="mt-4 flex flex-1 flex-col justify-end gap-3">{children}</div>
    </div>
  );
}

/** Import content from other documentation systems (Mintlify, Ghost, plus a
 *  pointer at the public-Git import that lives in the Git settings section). */
export function ImportTab({ projectId }: { projectId?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const mintlify = useImportFromMintlify(projectId ?? '');
  const ghost = useImportFromGhost(projectId ?? '');
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [ghostFile, setGhostFile] = useState<File | null>(null);
  const [results, setResults] = useState<{ mintlify?: ContentImportSummary; ghost?: ContentImportSummary }>({});

  const runMintlify = () => {
    const trimmedRepo = repo.trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(trimmedRepo)) {
      toast.error(t('settings.import.mintlify.invalidRepo'));
      return;
    }
    const trimmedBranch = branch.trim();
    mintlify.mutate(
      { repo: trimmedRepo, ...(trimmedBranch ? { branch: trimmedBranch } : {}) },
      {
        onSuccess: (summary) => {
          setResults((prev) => ({ ...prev, mintlify: summary }));
          toast.success(t('settings.import.success'));
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.import.error')),
      },
    );
  };

  const runGhost = async () => {
    if (!ghostFile) {
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
    ghost.mutate(parsed as Record<string, unknown>, {
      onSuccess: (summary) => {
        setResults((prev) => ({ ...prev, ghost: summary }));
        toast.success(t('settings.import.success'));
      },
      onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.import.error')),
    });
  };

  return (
    <SettingsSection description={t('settings.import.description')} title={t('settings.import.title')}>
      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <SourceCard
          description={t('settings.import.mintlify.description')}
          icon={<Leaf className="size-4" />}
          title={t('settings.import.mintlify.title')}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-mintlify-repo">{t('settings.import.mintlify.repo')}</Label>
            <Input
              className="font-mono"
              id="import-mintlify-repo"
              onChange={(event) => setRepo(event.target.value)}
              placeholder="acme/docs"
              value={repo}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-mintlify-branch">{t('settings.import.mintlify.branch')}</Label>
            <Input
              className="font-mono"
              id="import-mintlify-branch"
              onChange={(event) => setBranch(event.target.value)}
              placeholder="main"
              value={branch}
            />
          </div>
          <Button disabled={!projectId || !repo.trim() || mintlify.isPending} onClick={runMintlify} type="button">
            {mintlify.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <DownloadCloud className="size-3.5" />}
            {mintlify.isPending ? t('settings.import.running') : t('settings.import.run')}
          </Button>
          {results.mintlify ? <ImportResult projectId={projectId} summary={results.mintlify} /> : null}
        </SourceCard>

        <SourceCard description={t('settings.import.ghost.description')} icon={<Ghost className="size-4" />} title={t('settings.import.ghost.title')}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="import-ghost-file">{t('settings.import.ghost.file')}</Label>
            <Input
              accept=".json,application/json"
              id="import-ghost-file"
              onChange={(event) => setGhostFile(event.target.files?.[0] ?? null)}
              type="file"
            />
          </div>
          <Button disabled={!projectId || !ghostFile || ghost.isPending} onClick={runGhost} type="button">
            {ghost.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <DownloadCloud className="size-3.5" />}
            {ghost.isPending ? t('settings.import.running') : t('settings.import.run')}
          </Button>
          {results.ghost ? <ImportResult projectId={projectId} summary={results.ghost} /> : null}
        </SourceCard>

        <SourceCard description={t('settings.import.git.description')} icon={<GitBranch className="size-4" />} title={t('settings.import.git.title')}>
          <Button
            disabled={!projectId}
            onClick={() => navigate({ to: '/app/projects/$projectId/settings', params: { projectId: projectId ?? '' }, search: { section: 'git' } })}
            type="button"
            variant="outline"
          >
            {t('settings.import.git.open')} <ArrowUpRight className="size-3.5" />
          </Button>
        </SourceCard>
      </div>
    </SettingsSection>
  );
}
