import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useLocale } from '@nibleaf/i18n/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { friendlyErrorMessage, type GitConflict } from '@/hooks/api';
import type { GitConflictChoice } from '../model/git-conflict-resolution';
import { useGitConflictResolutionCommand } from './use-git-conflict-resolution';

/**
 * One open conflict of a site's two-way sync: the base, Nibleaf and Git
 * versions side by side, a custom resolution, and the four ways to resolve it.
 * The custom text starts as the Nibleaf version and is kept through refetches,
 * language changes and failed or refused resolutions.
 */
export function GitConflictCard({ projectId, conflict }: { projectId: string; conflict: GitConflict }) {
  const { t } = useLocale();
  // The custom text belongs to this site's conflict: shown another one, the card starts from that one's Nibleaf version.
  const [draft, setDraft] = useState({ projectId, conflictId: conflict.id, text: conflict.oursContent ?? '' });
  const custom = draft.projectId === projectId && draft.conflictId === conflict.id ? draft.text : (conflict.oursContent ?? '');
  const command = useGitConflictResolutionCommand(projectId, conflict.id);
  const resolveConflict = (choice: GitConflictChoice) =>
    command.resolve(choice, custom, (error) => toast.error(friendlyErrorMessage(t, error, 'settings.git.workflow.conflict.error')));
  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <code className="text-sm">{conflict.path}</code>
        <Badge variant="destructive">{t('settings.git.workflow.conflict.badge')}</Badge>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {(
          [
            [t('settings.git.workflow.conflict.base'), conflict.baseContent],
            ['Nibleaf', conflict.oursContent],
            ['Git', conflict.theirsContent],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <Label>{label}</Label>
            <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-3 text-xs">
              {value ?? t('settings.git.workflow.conflict.deleted')}
            </pre>
          </div>
        ))}
      </div>
      <Label className="mt-3" htmlFor={`custom-${conflict.id}`}>
        {t('settings.git.workflow.conflict.custom')}
      </Label>
      <Textarea
        className="mt-1 min-h-32 font-mono text-xs"
        id={`custom-${conflict.id}`}
        onChange={(event) => setDraft({ projectId, conflictId: conflict.id, text: event.target.value })}
        value={custom}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button loading={command.busy} onClick={() => resolveConflict('OURS')} size="sm">
          {t('settings.git.workflow.conflict.useNibleaf')}
        </Button>
        <Button loading={command.busy} onClick={() => resolveConflict('THEIRS')} size="sm" variant="outline">
          {t('settings.git.workflow.conflict.useGit')}
        </Button>
        <Button loading={command.busy} onClick={() => resolveConflict('CUSTOM')} size="sm" variant="secondary">
          {t('settings.git.workflow.conflict.useCustom')}
        </Button>
        <Button loading={command.busy} onClick={() => resolveConflict('DELETE')} size="sm" variant="destructive">
          {t('settings.git.workflow.conflict.delete')}
        </Button>
      </div>
    </section>
  );
}
