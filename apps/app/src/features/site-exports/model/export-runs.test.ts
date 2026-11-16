import { describe, expect, it } from 'vitest';
import {
  type ExportRunSource,
  exportRunRow,
  isArtifactRequest,
  isRunRequest,
  isSiteRequest,
  liveVersionKnown,
  manualExport,
  toggleExportFormat,
} from './export-runs';

const run = (overrides: Partial<ExportRunSource> = {}): ExportRunSource => ({
  id: 'run-1',
  formats: ['MARKDOWN', 'PDF'],
  status: 'SUCCEEDED',
  trigger: 'MANUAL',
  attempts: 1,
  error: null,
  createdAt: '2026-10-16T00:00:00Z',
  snapshot: { deploymentVersion: 4, pagesCount: 3 },
  artifacts: [
    { id: 'zip', format: 'MARKDOWN', size: 1024 },
    { id: 'pdf', format: 'PDF', size: 2048 },
  ],
  schedule: null,
  ...overrides,
});
const idle = { cancel: [], download: [] };

describe('liveVersionKnown', () => {
  it.each([
    [true, undefined, true],
    [undefined, true, true],
    [false, true, true],
    [true, false, true],
    [false, false, false],
    // Unknown is not "never published": either answer still missing keeps it unknown.
    [false, undefined, undefined],
    [undefined, false, undefined],
    [undefined, undefined, undefined],
  ] as const)('site says %s, recent deployments say %s: %s', (project, recent, expected) => {
    expect(liveVersionKnown(project, recent)).toBe(expected);
  });
});

describe('manualExport', () => {
  it('keeps the button reachable with its reason for people who cannot start exports', () => {
    expect(manualExport({ canCreate: false, hasLiveVersion: true })).toEqual({ hint: 'access.viewOnly.action', unavailable: true });
  });
  it('asks to publish first only when the site is known to be unpublished', () => {
    expect(manualExport({ canCreate: true, hasLiveVersion: false })).toEqual({
      hint: 'settings.exports.workflow.publishFirst',
      unavailable: true,
    });
    expect(manualExport({ canCreate: true, hasLiveVersion: undefined })).toEqual({
      hint: 'settings.exports.workflow.formatHint',
      unavailable: false,
    });
    expect(manualExport({ canCreate: true, hasLiveVersion: true }).unavailable).toBe(false);
  });
});

describe('toggleExportFormat', () => {
  it('adds formats in the order they are turned on and removes them', () => {
    expect(toggleExportFormat(['MARKDOWN'], 'STATIC_HTML')).toEqual(['MARKDOWN', 'STATIC_HTML']);
    expect(toggleExportFormat(['MARKDOWN', 'STATIC_HTML'], 'PDF')).toEqual(['MARKDOWN', 'STATIC_HTML', 'PDF']);
    expect(toggleExportFormat(['MARKDOWN', 'STATIC_HTML', 'PDF'], 'MARKDOWN')).toEqual(['STATIC_HTML', 'PDF']);
  });
  it('keeps at least one format', () => {
    const current = ['PDF'] as const;
    expect(toggleExportFormat(current, 'PDF')).toEqual(['PDF']);
  });
});

describe('request matching', () => {
  const request = { projectId: 'site-a', runId: 'run-1', artifactId: 'pdf' };
  it('matches only the same site, run and artifact', () => {
    expect(isSiteRequest({ projectId: 'site-a', formats: ['PDF'] }, 'site-a')).toBe(true);
    expect(isSiteRequest({ projectId: 'site-b' }, 'site-a')).toBe(false);
    expect(isRunRequest({ projectId: 'site-a', runId: 'run-1' }, request)).toBe(true);
    expect(isRunRequest({ projectId: 'site-b', runId: 'run-1' }, request)).toBe(false);
    expect(isRunRequest({ projectId: 'site-a', runId: 'run-2' }, request)).toBe(false);
    expect(isArtifactRequest(request, request)).toBe(true);
    expect(isArtifactRequest({ ...request, artifactId: 'zip' }, request)).toBe(false);
    expect(isArtifactRequest({ ...request, projectId: 'site-b' }, request)).toBe(false);
  });
  it.each([undefined, null, 'site-a', 1, []])('ignores variables that are not a request (%s)', (variables) => {
    expect(isSiteRequest(variables, 'site-a')).toBe(false);
    expect(isRunRequest(variables, request)).toBe(false);
  });
});

describe('exportRunRow', () => {
  it('says what the run is, with the existing labels', () => {
    const row = exportRunRow('site-a', run({ status: 'FAILED' }), { canCreate: true, pending: idle });
    expect(row.formats).toEqual(['settings.exports.workflow.format.markdown', 'settings.exports.workflow.format.pdf']);
    expect(row.status).toEqual({ label: 'settings.exports.workflow.status.failed', variant: 'destructive' });
    expect(row.trigger).toEqual({ label: 'settings.exports.workflow.manual' });
    expect(row.artifacts.map(({ format, size, request }) => ({ format, size, request }))).toEqual([
      { format: 'settings.exports.workflow.format.markdown', size: 1024, request: { projectId: 'site-a', runId: 'run-1', artifactId: 'zip' } },
      { format: 'settings.exports.workflow.format.pdf', size: 2048, request: { projectId: 'site-a', runId: 'run-1', artifactId: 'pdf' } },
    ]);
  });

  it.each([
    ['PENDING', 'secondary'],
    ['RUNNING', 'secondary'],
    ['SUCCEEDED', 'default'],
    ['CANCELLED', 'secondary'],
  ] as const)('maps %s to its badge', (status, variant) => {
    expect(exportRunRow('site-a', run({ status }), { canCreate: true, pending: idle }).status).toEqual({
      label: `settings.exports.workflow.status.${status.toLowerCase()}`,
      variant,
    });
  });

  it('names a scheduled run after its schedule, or says it was scheduled', () => {
    const scheduled = (schedule: { name: string } | null) =>
      exportRunRow('site-a', run({ trigger: 'SCHEDULED', schedule }), { canCreate: true, pending: idle }).trigger;
    expect(scheduled({ name: 'Nightly' })).toEqual({ name: 'Nightly' });
    expect(scheduled(null)).toEqual({ label: 'settings.exports.workflow.scheduled' });
  });

  it('offers Cancel only while queued or running, and only to people who may start exports', () => {
    const cancel = (status: ExportRunSource['status'], canCreate = true) =>
      exportRunRow('site-a', run({ status }), { canCreate, pending: idle }).cancel;
    expect(cancel('PENDING')).toEqual({ request: { projectId: 'site-a', runId: 'run-1' }, busy: false });
    expect(cancel('RUNNING')).not.toBeNull();
    expect(cancel('RUNNING', false)).toBeNull();
    for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const) expect(cancel(status)).toBeNull();
  });

  it('is busy only for its own site’s run and artifact', () => {
    const row = (projectId: string, pending: { cancel: unknown[]; download: unknown[] }) =>
      exportRunRow(projectId, run({ status: 'RUNNING' }), { canCreate: true, pending });
    const pending = {
      cancel: [
        { projectId: 'site-a', runId: 'run-1' },
        { projectId: 'site-a', runId: 'run-2' },
      ],
      download: [{ projectId: 'site-a', runId: 'run-1', artifactId: 'pdf' }],
    };
    expect(row('site-a', pending).cancel?.busy).toBe(true);
    expect(row('site-a', pending).artifacts.map((artifact) => artifact.busy)).toEqual([false, true]);
    // The same run id on another site is another run.
    expect(row('site-b', pending).cancel?.busy).toBe(false);
    expect(row('site-b', pending).artifacts.map((artifact) => artifact.busy)).toEqual([false, false]);
  });
});
