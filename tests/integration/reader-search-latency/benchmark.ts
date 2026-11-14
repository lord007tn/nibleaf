import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { prisma } from '@nibleaf/database';
import type { SiteSnapshot, SnapshotPage } from '@nibleaf/shared/site';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

// Dedicated disposable DB only; never inherit a developer or production URL.
const controls = vi.hoisted(() => {
  process.env.POSTGRES_URL = 'postgresql://user:passer@127.0.0.1:55463/reader_search_latency';
  return { delayMs: 0, readinessCalls: 0 };
});
vi.mock('@/env', () => ({ env: { SEARCH_RUNTIME: 'hybrid', SEARCH_CACHE_TTL_MS: 0 } }));
vi.mock('@nibleaf/qdrant', () => ({ getQdrantClient: () => ({}) }));
vi.mock('@/lib/ai-search/readiness', () => ({
  configuredIndexServing: async () => {
    controls.readinessCalls++;
    await delay(controls.delayMs);
    return false;
  },
  findCurrentIndexRun: vi.fn(),
  indexRunServesAnswers: () => false,
}));
vi.mock('@nibleaf/search/workspace', () => ({
  resolveWorkspaceAi: () => {
    throw new Error('Benchmark must never contact a provider');
  },
  workspaceEmbeddingProvider: vi.fn(),
  workspaceAnswerProvider: vi.fn(),
}));
vi.mock('@nibleaf/storage', () => ({ getObjectStream: vi.fn() }));
vi.mock('@/actions/importers/ghost-assets', () => ({ fetchPublicImage: vi.fn() }));
vi.mock('@/lib/ai-search/quota', () => ({ consumeAnswerQuota: vi.fn(), recordAnswerServed: vi.fn() }));
// Keep a slow analytics sink pending to prove it is outside the measured path.
vi.mock('@/actions/analytics', () => ({ trackProjectEvent: vi.fn(), trackProjectEvents: () => new Promise(() => undefined) }));
vi.mock('@/actions/notifications', () => ({ createNotificationsForOrgMembers: vi.fn() }));

import { searchSite } from '@/actions/sites';

const projectId = 'reader-search-latency-fixture';
const queries = ['custom domain', 'publsh', 'zzqxv', 'نطاق', 'promo code', 'zzqxv', 'الحجوزات', 'reservation', 'install'];
const topics = [
  ['Custom domain', 'نطاق مخصص', 'Connect your custom domain and configure DNS. إعداد نطاق مخصص'],
  ['Publishing', 'النشر', 'Publish documentation from the dashboard. نشر الموقع'],
  ['Promo code', 'رمز ترويجي', 'Create a promo code for reservations. رمز ترويجي للحجوزات'],
  ['Reservation', 'الحجوزات', 'Manage a reservation and update guest details. إدارة الحجوزات'],
  ['Install', 'التثبيت', 'Install the CLI to get started. خطوات التثبيت'],
] as const;
const pages: SnapshotPage[] = Array.from({ length: 300 }, (_, index) => {
  const ar = index >= 150;
  const topic = topics[index % topics.length];
  if (!topic) throw new Error('Missing fixture topic');
  return {
    id: `page-${index}`,
    parentId: null,
    versionId: 'version-main',
    languageCode: ar ? 'ar' : 'en',
    title: topic[ar ? 1 : 0],
    path: `guide-${index}`,
    position: index,
    kind: 'PAGE',
    description: null,
    icon: null,
    config: null,
    translationKey: null,
    hidden: false,
    content: Array.from({ length: 8 }, (_, section) => `## ${topic[ar ? 1 : 0]} ${section}\n\n${topic[2].repeat(10)}`).join('\n\n'),
  };
});
const snapshot: SiteSnapshot = {
  project: {
    id: projectId,
    name: 'Fictional latency docs',
    slug: projectId,
    description: null,
    icon: null,
    config: {},
    languages: [
      { code: 'en', label: 'English', direction: 'LTR', isDefault: true, config: null },
      { code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, config: null },
    ],
    versions: [{ id: 'version-main', name: 'Main', slug: 'main', isDefault: true }],
  },
  pages,
  generatedAt: '2026-11-13T00:00:00.000Z',
};
const app = new Hono().use(contextStorage()).get('/search', async (ctx) => {
  const started = performance.now();
  const data = await searchSite(projectId, ctx.req.query('q') ?? '', undefined, 12, undefined, { consentState: 'denied' }, 'en');
  ctx.header('Server-Timing', `search;dur=${performance.now() - started}`);
  return ctx.json({ data });
});

beforeAll(async () => {
  const db = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
  expect(db[0]?.name).toBe('reader_search_latency');
  await prisma.usagePlan.upsert({ where: { key: 'free' }, create: { key: 'free', name: 'Free' }, update: {} });
  await prisma.organization.upsert({
    where: { id: 'latency-org' },
    create: { id: 'latency-org', name: 'Fictional org', slug: 'latency-org' },
    update: {},
  });
  await prisma.project.upsert({
    where: { id: projectId },
    create: { id: projectId, organizationId: 'latency-org', name: snapshot.project.name, slug: projectId, config: {} },
    update: {},
  });
  for (const language of snapshot.project.languages) {
    await prisma.language.upsert({
      where: { projectId_code: { projectId, code: language.code } },
      create: { projectId, code: language.code, label: language.label, direction: language.direction, isDefault: language.isDefault },
      update: {},
    });
  }
  await prisma.deployment.upsert({
    where: { projectId_version: { projectId, version: 1 } },
    create: { projectId, version: 1, status: 'READY', snapshot: JSON.parse(JSON.stringify(snapshot)) },
    update: { snapshot: JSON.parse(JSON.stringify(snapshot)) },
  });
});
afterAll(() => prisma.$disconnect());

it('measures the audit queries against a seeded PostgreSQL publication and real keyword search', async () => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Outbound HTTP is disabled in this fixture');
  });
  const reports: Array<{
    readinessDelayMs: number;
    coldMs: number;
    samples: number;
    p50Ms: number | undefined;
    p95Ms: number | undefined;
    perQuery: Array<{ query: string; resultHash: string; p50Ms: number | undefined; p95Ms: number | undefined }>;
  }> = [];
  for (const readinessDelayMs of [0, 700]) {
    controls.delayMs = readinessDelayMs;
    const samples: number[] = [];
    const perQuery = queries.map((query) => ({ query, samples: [] as number[], resultHash: '' }));
    let coldMs = 0;
    for (let round = 0; round < 7; round++) {
      for (const [index, query] of queries.entries()) {
        const response = await app.request(`/search?q=${encodeURIComponent(query)}`);
        expect(response.status).toBe(200);
        const { data } = await response.json();
        expect(data.runtime).toBe('legacy-fallback');
        expect(data.hits.length).toBeLessThanOrEqual(12);
        if (['publsh', 'zzqxv'].includes(query)) expect(data.hits).toEqual([]);
        else expect(data.hits.length, query).toBeGreaterThan(0);
        const ms = Number(response.headers.get('server-timing')?.split('=')[1]);
        if (round === 0 && index === 0) coldMs = ms;
        if (round >= 2) {
          samples.push(ms);
          const row = perQuery[index];
          if (!row) throw new Error('Missing query fixture');
          row.samples.push(ms);
          const resultHash = createHash('sha256').update(JSON.stringify(data.hits)).digest('hex');
          if (row.resultHash) expect(resultHash).toBe(row.resultHash);
          row.resultHash = resultHash;
        }
      }
    }
    const percentiles = (values: number[]) => {
      const sorted = values.toSorted((a, b) => a - b);
      return { p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] };
    };
    expect(controls.readinessCalls).toBeGreaterThan(0);
    if (readinessDelayMs === 700 && process.env.SEARCH_BENCH_BASELINE === '1') expect(Math.min(...samples)).toBeGreaterThan(650);
    reports.push({
      readinessDelayMs,
      coldMs,
      samples: samples.length,
      ...percentiles(samples),
      perQuery: perQuery.map(({ samples: values, ...row }) => ({ ...row, ...percentiles(values) })),
    });
  }
  await mkdir('output/search-latency', { recursive: true });
  const label = process.env.SEARCH_BENCH_BASELINE === '1' ? 'before' : 'after';
  await writeFile(
    `output/search-latency/${label}.json`,
    JSON.stringify(
      {
        label,
        pages: 300,
        measurement: 'Hono search action Server-Timing; real PostgreSQL and Orama; controlled readiness delay; no external HTTP',
        reports,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ label, reports: reports.map(({ perQuery: _, ...summary }) => summary) }));
});
