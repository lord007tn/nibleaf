import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDashboardPreloads, routeIdFromModuleId, transitiveImports } from './dashboard-preload-plugin.ts';

const routesRoot = join(import.meta.dirname, '..', 'src', 'routes');
const routeModule = (file: string, query = '') => `C:/repo/apps/app/src/routes/${file}${query}`;

describe('routeIdFromModuleId', () => {
  it.each([
    ['app/route.tsx', '/app'],
    ['app/(dashboard)/route.tsx', '/app/(dashboard)'],
    ['app/(dashboard)/index.tsx', '/app/(dashboard)/'],
    ['app/(dashboard)/sites.tsx', '/app/(dashboard)/sites'],
    ['app/projects/$projectId/route.tsx', '/app/projects/$projectId'],
    ['app/projects/$projectId/index.tsx', '/app/projects/$projectId/'],
    ['app/projects/$projectId/analytics.tsx', '/app/projects/$projectId/analytics'],
    ['app/projects/$projectId/analytics.pages.tsx', '/app/projects/$projectId/analytics/pages'],
    ['app/projects/$projectId/analytics.index.tsx', '/app/projects/$projectId/analytics/'],
  ])('%s → %s', (file, routeId) => {
    expect(routeIdFromModuleId(routeModule(file))).toBe(routeId);
    expect(routeIdFromModuleId(routeModule(file, '?tsr-split=component'))).toBe(routeId);
  });

  it('reads Windows paths', () => {
    expect(routeIdFromModuleId('C:\\repo\\apps\\app\\src\\routes\\app\\(dashboard)\\sites.tsx?tsr-split=loader')).toBe('/app/(dashboard)/sites');
  });

  it('ignores non-route files', () => {
    expect(routeIdFromModuleId(routeModule('app/(dashboard)/-sites.test.tsx'))).toBeNull();
    expect(routeIdFromModuleId(routeModule('app/-route.test.ts'))).toBeNull();
    expect(routeIdFromModuleId('C:/repo/apps/app/src/components/app/shell.tsx')).toBeNull();
  });

  it('maps every dashboard route file to a route id in routeTree.gen.ts', () => {
    const routeTree = readFileSync(join(routesRoot, '..', 'routeTree.gen.ts'), 'utf8');
    const byId = routeTree.slice(routeTree.indexOf('export interface FileRoutesById'));
    const knownIds = new Set([...byId.slice(0, byId.indexOf('}')).matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]));
    const files = readdirSync(join(routesRoot, 'app'), { recursive: true, encoding: 'utf8' })
      .map((file) => relative(routesRoot, join(routesRoot, 'app', file)).replaceAll('\\', '/'))
      .filter((file) => /\.tsx?$/.test(file) && !file.split('/').some((part) => part.startsWith('-')));
    expect(files.length).toBeGreaterThan(20);
    const ids = files.map((file) => routeIdFromModuleId(routeModule(file)));
    expect(ids.filter((id) => !(id && knownIds.has(id)))).toEqual([]);
    // And every dashboard route in the tree has its file.
    expect([...knownIds].filter((id) => id.startsWith('/app') && !ids.includes(id))).toEqual([]);
  });
});

describe('transitiveImports', () => {
  it('follows static imports through cycles, including the start', () => {
    const graph: Record<string, string[]> = { a: ['b', 'c'], b: ['d'], c: ['d', 'a'], d: [] };
    expect([...transitiveImports('a', (file) => graph[file])].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...transitiveImports('b', (file) => graph[file])].sort()).toEqual(['b', 'd']);
  });
});

describe('buildDashboardPreloads', () => {
  const chunk = (fileName: string, facadeModuleId: string | null, imports: string[] = [], isEntry = false) => ({
    fileName,
    facadeModuleId,
    imports,
    isEntry,
  });

  it('unions the split chunks of a route and leaves out what the entry loads', () => {
    const chunks = [
      chunk('assets/main.js', 'C:/repo/apps/app/src/client.tsx', ['assets/index.js'], true),
      chunk('assets/index.js', null, ['assets/react.js']),
      chunk('assets/react.js', null),
      chunk('assets/sites.js', routeModule('app/(dashboard)/sites.tsx', '?tsr-split=component'), ['assets/table.js', 'assets/react.js']),
      chunk('assets/sites-loader.js', routeModule('app/(dashboard)/sites.tsx', '?tsr-split=loader'), ['assets/queries.js']),
      chunk('assets/table.js', null, ['assets/icons.js', 'assets/index.js']),
      chunk('assets/icons.js', null),
      chunk('assets/queries.js', null),
      chunk('assets/docs.js', routeModule('sites/$projectId/$.tsx', '?tsr-split=component'), ['assets/icons.js']),
    ];
    expect(buildDashboardPreloads(chunks)).toEqual({
      '/app/(dashboard)/sites': ['/assets/icons.js', '/assets/queries.js', '/assets/sites-loader.js', '/assets/sites.js', '/assets/table.js'],
    });
  });
});
