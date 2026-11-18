import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  dashboardCatalogChunks,
  dashboardCatalogFailures,
  dashboardCatalogRouteFailures,
  dashboardLocaleGzipBudget,
  dashboardLocales,
  serverCatalogFailures,
} from './dashboard-catalog-budget.mjs';

const catalogs = () => dashboardLocales.map((locale) => ({ locale, files: [`assets/${locale}.js`], gzip: 1000 }));

describe('dashboard catalog budgets', () => {
  it('finds one compiled module per locale in a Windows module report', () => {
    expect(
      dashboardCatalogChunks([
        { fileName: 'assets/ar.js', modules: [{ id: 'C:\\repo\\packages\\i18n\\src\\generated\\dashboard\\messages\\ar.js' }] },
      ]).find((row) => row.locale === 'ar')?.files,
    ).toEqual(['assets/ar.js']);
  });

  it('rejects a deliberately oversized gzip fixture', () => {
    const fixture = gzipSync(randomBytes(dashboardLocaleGzipBudget + 1000), { level: 9 }).byteLength;
    const reports = catalogs();
    reports.find((row) => row.locale === 'ar').gzip = fixture;
    expect(dashboardCatalogFailures(reports, new Set())).toContain(`ar: ${fixture} exceeds ${dashboardLocaleGzipBudget} gzip bytes`);
  });

  it('finds the server catalog in a startup file that is not a route preload', () => {
    const modules = new Map([
      ['assets/startup.js', [{ id: '/repo/packages/i18n/src/dashboard-catalog.server.ts' }]],
      ['assets/client.js', [{ id: '/repo/packages/i18n/src/dashboard-catalog.client.ts' }]],
    ]);
    expect(serverCatalogFailures(new Set(['/assets/client.js', 'assets/startup.js']), modules)).toEqual([
      'assets/startup.js includes the server catalog.',
    ]);
  });

  it('rejects dashboard catalog code on every route outside the dashboard family', () => {
    const modules = new Map([
      ['assets/catalog.js', [{ id: '/repo/packages/i18n/src/generated/dashboard/messages/en.js' }]],
      ['assets/plain.js', [{ id: '/repo/apps/app/src/components/marketing/blog.tsx' }]],
    ]);
    const routes = {
      __root__: { preloads: ['/assets/catalog.js'] },
      '/$page': { preloads: ['/assets/catalog.js'] },
      '/blog/$slug': { preloads: ['/assets/plain.js'] },
      '/(auth)/sign-in': { preloads: ['/assets/catalog.js'] },
      '/app/o/$orgSlug': { preloads: ['/assets/catalog.js'] },
      '/join/$token': { preloads: ['/assets/catalog.js'] },
    };
    expect(dashboardCatalogRouteFailures(routes, modules)).toEqual([
      '/$page preloads dashboard catalog code in /assets/catalog.js.',
      '/(auth)/sign-in preloads dashboard catalog code in /assets/catalog.js.',
    ]);
  });

  it('rejects merged, missing and nonactive initial catalog chunks', () => {
    const reports = catalogs();
    reports.find((row) => row.locale === 'ar').files = ['assets/de.js'];
    reports.find((row) => row.locale === 'hi').files = [];
    expect(dashboardCatalogFailures(reports, new Set(['assets/de.js']))).toEqual(
      expect.arrayContaining([
        "ar: nonactive catalog is in dashboard-home's initial preloads",
        'de: shares a catalog chunk with ar',
        'hi: expected one catalog chunk, found 0',
      ]),
    );
  });
});
