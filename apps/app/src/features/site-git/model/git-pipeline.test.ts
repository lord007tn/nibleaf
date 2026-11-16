import { describe, expect, it } from 'vitest';
import { type PipelineDeployment, type PipelineGitMetadata, pipelineBuild, pipelineImport, pipelineLive } from './git-pipeline';

const EARLY = '2026-11-15T09:00:00.000Z';
const LATE = '2026-11-15T10:30:00.000Z';

describe('pipelineImport: manual import vs push sync', () => {
  it.each<[string, PipelineGitMetadata, ReturnType<typeof pipelineImport>]>([
    ['nothing yet', {}, { tone: 'idle', kind: 'never' }],
    ['empty timestamps read as nothing', { lastImportedAt: '', lastSyncAt: '' }, { tone: 'idle', kind: 'never' }],
    ['manual import only', { lastImportedAt: EARLY }, { tone: 'done', kind: 'imported', at: EARLY }],
    ['push sync only', { lastSyncAt: EARLY, lastSyncStatus: 'ok' }, { tone: 'done', kind: 'synced', at: EARLY }],
    ['push sync only, status unknown', { lastSyncAt: EARLY }, { tone: 'done', kind: 'synced', at: EARLY }],
    ['newer manual import wins', { lastImportedAt: LATE, lastSyncAt: EARLY, lastSyncStatus: 'ok' }, { tone: 'done', kind: 'imported', at: LATE }],
    ['newer push sync wins', { lastImportedAt: EARLY, lastSyncAt: LATE, lastSyncStatus: 'ok' }, { tone: 'done', kind: 'synced', at: LATE }],
    ['a tie goes to the push sync', { lastImportedAt: EARLY, lastSyncAt: EARLY, lastSyncStatus: 'ok' }, { tone: 'done', kind: 'synced', at: EARLY }],
    [
      'failed push sync, newest, with its error',
      { lastImportedAt: EARLY, lastSyncAt: LATE, lastSyncStatus: 'failed', lastSyncError: 'fatal: <b>repo</b> not found' },
      { tone: 'failed', kind: 'syncFailed', at: LATE, error: 'fatal: <b>repo</b> not found' },
    ],
    ['failed push sync with no error text', { lastSyncAt: LATE, lastSyncStatus: 'failed' }, { tone: 'failed', kind: 'syncFailed', at: LATE }],
    [
      'failed push sync with an empty error',
      { lastSyncAt: LATE, lastSyncStatus: 'failed', lastSyncError: '' },
      { tone: 'failed', kind: 'syncFailed', at: LATE },
    ],
    [
      'failed push sync tied with a manual import still shows the failure',
      { lastImportedAt: LATE, lastSyncAt: LATE, lastSyncStatus: 'failed', lastSyncError: 'boom' },
      { tone: 'failed', kind: 'syncFailed', at: LATE, error: 'boom' },
    ],
    [
      'a later manual import replaces an older failed sync',
      { lastImportedAt: LATE, lastSyncAt: EARLY, lastSyncStatus: 'failed', lastSyncError: 'boom' },
      { tone: 'done', kind: 'imported', at: LATE },
    ],
    [
      'a later successful sync replaces the failure',
      { lastImportedAt: EARLY, lastSyncAt: LATE, lastSyncStatus: 'ok', lastSyncError: 'stale error' },
      { tone: 'done', kind: 'synced', at: LATE },
    ],
  ])('%s', (_name, git, expected) => {
    expect(pipelineImport(git)).toEqual(expected);
  });

  it('compares the original ISO strings, not parsed instants', () => {
    // Lexicographic, exactly as before: an offset form of a later instant still sorts by its text.
    expect(pipelineImport({ lastImportedAt: '2026-11-15T10:00:00.000Z', lastSyncAt: '2026-11-15T09:30:00.000-01:00' })).toEqual({
      tone: 'done',
      kind: 'imported',
      at: '2026-11-15T10:00:00.000Z',
    });
  });
});

describe('pipelineBuild: the newest attempt', () => {
  const attempt = (status: PipelineDeployment['status']): PipelineDeployment => ({ status, version: 7, pagesCount: 12 });
  it.each<[string, PipelineDeployment | undefined, ReturnType<typeof pipelineBuild>]>([
    ['no attempts', undefined, { tone: 'idle', kind: 'none' }],
    ['pending', attempt('PENDING'), { tone: 'active', kind: 'building', version: 7 }],
    ['building', attempt('BUILDING'), { tone: 'active', kind: 'building', version: 7 }],
    ['failed', attempt('FAILED'), { tone: 'failed', kind: 'failed', version: 7 }],
    ['ready', attempt('READY'), { tone: 'done', kind: 'built', version: 7, pages: 12 }],
    ['ready with no pages', { status: 'READY', version: 1, pagesCount: 0 }, { tone: 'done', kind: 'built', version: 1, pages: 0 }],
  ])('%s', (_name, latest, expected) => {
    expect(pipelineBuild(latest)).toEqual(expected);
  });
});

describe('pipelineLive: the version already selected as live', () => {
  it('is live with that version and its page count', () => {
    expect(pipelineLive({ version: 3, pagesCount: 4 })).toEqual({ tone: 'done', kind: 'live', version: 3, pages: 4 });
  });
  it('is not live with nothing selected', () => {
    expect(pipelineLive(undefined)).toEqual({ tone: 'idle', kind: 'notLive' });
  });
  it.each<[string, PipelineDeployment, PipelineDeployment | undefined]>([
    ['a newer failure keeps the older live version', { status: 'FAILED', version: 9, pagesCount: 5 }, { status: 'READY', version: 8, pagesCount: 4 }],
    [
      'a build in flight keeps the older live version',
      { status: 'BUILDING', version: 9, pagesCount: 0 },
      { status: 'READY', version: 8, pagesCount: 4 },
    ],
    ['a first build in flight is not live', { status: 'PENDING', version: 1, pagesCount: 0 }, undefined],
  ])('%s', (_name, latest, live) => {
    expect(pipelineBuild(latest).kind).not.toBe('built');
    expect(pipelineLive(live)).toEqual(
      live ? { tone: 'done', kind: 'live', version: live.version, pages: live.pagesCount } : { tone: 'idle', kind: 'notLive' },
    );
  });
});
