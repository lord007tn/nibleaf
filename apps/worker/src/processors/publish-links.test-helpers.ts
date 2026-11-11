import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { vi } from 'vitest';

vi.mock('@nibleaf/clickhouse', () => ({
  keys: () => ({}),
  clickHouseWritesEnabled: () => false,
  deterministicAnalyticsEventId: vi.fn(),
  buildAnalyticsEvent: vi.fn(),
}));
vi.mock('@nibleaf/database', () => ({ Prisma: { DbNull: null }, prisma: {} }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), getJob: vi.fn(), QueueNames: { SEARCH: 'search', PUBLISH: 'publish' } }));
vi.mock('../lib/publish-activation', () => ({ recordPublishReady: vi.fn() }));
vi.mock('../env', () => ({ env: { APP_URL: 'https://nibleaf.test' } }));
vi.mock('../lib/notify', () => ({ notifyDeployment: vi.fn() }));
vi.mock('../lib/usage-ingest', () => ({ DurableUsageEnqueueError: Error, enqueueAnalyticsEvent: vi.fn() }));

// The publish dialog's preflight lives in the server app; the parity test runs
// the same snapshot through it and through this worker gate.
export { collectPublishChecks } from '../../../server/src/lib/publish-checks';
export { collectPublishIssues } from './publish';

let sequence = 0;
export const page = (overrides: Partial<SnapshotPage> & Pick<SnapshotPage, 'path'>): SnapshotPage => {
  sequence += 1;
  return {
    id: `page-${sequence}`,
    parentId: null,
    versionId: 'v1',
    updatedAt: '2026-11-01T00:00:00.000Z',
    languageCode: 'en',
    kind: 'PAGE',
    title: `Page ${sequence}`,
    slug: overrides.path.split('/').at(-1) ?? '',
    icon: null,
    description: null,
    content: 'Body.',
    config: null,
    translationKey: null,
    position: sequence,
    hidden: false,
    ...overrides,
  };
};

export const snapshot = (pages: SnapshotPage[], config: Record<string, unknown> | null = null, extra: Partial<SiteSnapshot> = {}): SiteSnapshot => ({
  project: {
    id: 'project-1',
    name: 'Docs',
    slug: 'docs',
    description: null,
    icon: null,
    config,
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null },
      { code: 'fr', label: 'Français', direction: 'LTR', isDefault: false, enabled: false, config: null },
    ],
    versions: [
      { id: 'v1', name: 'Latest', slug: 'latest', isDefault: true },
      { id: 'v2', name: 'v2', slug: 'v2', isDefault: false },
    ],
  },
  pages,
  generatedAt: '2026-11-01T00:00:00.000Z',
  ...extra,
});
