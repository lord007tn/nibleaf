/**
 * The Git pipeline card (Import → Build → Live) as pure logic: what each step
 * says from the site's Git import/sync metadata and its deployments. Rendered
 * by `components/git-pipeline.tsx`; tested in `git-pipeline.test.ts`.
 *
 * It takes plain values only. The component reads the deployments, picks the
 * live one (the attempts list is the newest 50, so the live-only list has a
 * say too) and formats dates and copy.
 */

/** How a step's marker looks. */
export type PipelineStepTone = 'done' | 'active' | 'failed' | 'idle';

/** The Git import/sync metadata the card reads (ISO timestamps, as stored). */
export interface PipelineGitMetadata {
  lastImportedAt?: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'ok' | 'failed';
  lastSyncError?: string;
}

/** The parts of a deployment the card reads. */
export interface PipelineDeployment {
  status: 'PENDING' | 'BUILDING' | 'READY' | 'FAILED';
  version: number;
  pagesCount: number;
}

/** Import: the push-webhook sync, the manual import, or neither. `at` is the original ISO timestamp. */
export type PipelineImport =
  | { tone: 'failed'; kind: 'syncFailed'; at: string; error?: string }
  | { tone: 'done'; kind: 'synced'; at: string }
  | { tone: 'done'; kind: 'imported'; at: string }
  | { tone: 'idle'; kind: 'never' };

/** Build: the newest attempt, whatever its outcome. */
export type PipelineBuild =
  | { tone: 'active'; kind: 'building'; version: number }
  | { tone: 'failed'; kind: 'failed'; version: number }
  | { tone: 'done'; kind: 'built'; version: number; pages: number }
  | { tone: 'idle'; kind: 'none' };

/** Live: the version readers see, which a newer failed or building attempt doesn't replace. */
export type PipelineLive = { tone: 'done'; kind: 'live'; version: number; pages: number } | { tone: 'idle'; kind: 'notLive' };

/**
 * Import step. The push-webhook sync wins over the manual import when it is the
 * more recent of the two, a tie included (ISO timestamps compare
 * lexicographically). A failed push sync never updates `lastImportedAt`, so it
 * stays the latest and shows, with its error when there is one.
 */
export function pipelineImport(git: PipelineGitMetadata): PipelineImport {
  const { lastImportedAt, lastSyncAt } = git;
  if (lastSyncAt && (!lastImportedAt || lastSyncAt >= lastImportedAt)) {
    if (git.lastSyncStatus === 'failed') {
      // An empty error adds nothing to the detail.
      return { tone: 'failed', kind: 'syncFailed', at: lastSyncAt, ...(git.lastSyncError ? { error: git.lastSyncError } : {}) };
    }
    return { tone: 'done', kind: 'synced', at: lastSyncAt };
  }
  return lastImportedAt ? { tone: 'done', kind: 'imported', at: lastImportedAt } : { tone: 'idle', kind: 'never' };
}

/** Build step, from the newest attempt (the head of the attempts list). */
export function pipelineBuild(latest: PipelineDeployment | undefined): PipelineBuild {
  if (!latest) return { tone: 'idle', kind: 'none' };
  if (latest.status === 'PENDING' || latest.status === 'BUILDING') return { tone: 'active', kind: 'building', version: latest.version };
  if (latest.status === 'FAILED') return { tone: 'failed', kind: 'failed', version: latest.version };
  return { tone: 'done', kind: 'built', version: latest.version, pages: latest.pagesCount };
}

/** Live step, from the deployment already selected as live (never from a build's outcome). */
export function pipelineLive(live: Pick<PipelineDeployment, 'version' | 'pagesCount'> | undefined): PipelineLive {
  return live ? { tone: 'done', kind: 'live', version: live.version, pages: live.pagesCount } : { tone: 'idle', kind: 'notLive' };
}
