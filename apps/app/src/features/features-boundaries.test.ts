import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type FeatureImports = { file: string; imports: string[] };

function importSpecifiers(source: string): string[] {
  const pattern = /\b(?:import|export)\s+[^'";]*?\s+from\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s*['"]([^'"]+)['"]/g;
  return [...source.matchAll(pattern)].flatMap((match) => match[1] ?? match[2] ?? match[3] ?? []);
}

/** Files and resolved paths are relative to apps/app/src, with forward slashes. */
export function checkFeatureImports(files: FeatureImports[]): string[] {
  const violations: string[] = [];
  for (const { file, imports } of files) {
    const owner = /^features\/([^/]+)\/(model|api|components)\//.exec(file);
    const feature = /^features\/([^/]+)\//.exec(file)?.[1];
    if (!feature) continue;
    for (const specifier of imports) {
      const target = specifier.startsWith('@/')
        ? posix.normalize(specifier.slice(2))
        : specifier.startsWith('.')
          ? posix.normalize(posix.join(posix.dirname(file), specifier))
          : null;
      const dependency = target && /^features\/([^/]+)(?:\/(.*))?$/.exec(target);
      const dependencyPath = dependency?.[2] ?? '';
      const reason = (message: string) => violations.push(`${file} -> ${specifier}: ${message}`);
      if (target === 'routes' || target?.startsWith('routes/')) reason('features must not import routes');
      if (
        owner?.[2] === 'model' &&
        (/^(?:react(?:-dom)?(?:\/|$)|@tanstack\/|@nibleaf\/design-system(?:\/|$))/.test(specifier) ||
          target === 'services' ||
          target?.startsWith('services/') ||
          // App components and the data layer (even type-only): a model takes plain values.
          target === 'components' ||
          target?.startsWith('components/') ||
          target === 'hooks/api' ||
          target?.startsWith('hooks/api/') ||
          (dependency && /^(?:api|components)(?:\/|$)/.test(dependencyPath)))
      ) {
        reason('models must stay pure');
      }
      if (
        owner?.[2] === 'api' &&
        (target === 'components' || target?.startsWith('components/') || (dependency && /^components(?:\/|$)/.test(dependencyPath)))
      ) {
        reason('API modules must not import components');
      }
      if (dependency && dependency[1] !== feature) {
        const entry = posix.extname(dependencyPath) ? dependencyPath : `${dependencyPath}.${dependencyPath.startsWith('components/') ? 'tsx' : 'ts'}`;
        if (!/^(?:api\/(?:keys|query-options|hooks|mutations)\.ts|model\/[^/]+\.ts|components\/[^/]+\.tsx)$/.test(entry)) {
          reason('cross-feature imports must use public entrypoints');
        }
      }
    }
  }
  return violations;
}

function collectFeatureImports(directory: string, src: string): FeatureImports[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) return collectFeatureImports(file, src);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
    return [{ file: relative(src, file).replaceAll('\\', '/'), imports: importSpecifiers(readFileSync(file, 'utf8')) }];
  });
}

describe('feature import boundaries', () => {
  it('keeps the current feature tree within its layer and public-entrypoint boundaries', () => {
    const src = fileURLToPath(new URL('../', import.meta.url));
    expect(checkFeatureImports(collectFeatureImports(join(src, 'features'), src))).toEqual([]);
  });

  it('extracts static imports, re-exports, dynamic imports and side-effect imports', () => {
    expect(
      importSpecifiers(`
        import type { Access } from '@/features/access/model/access';
        import React, { useState } from 'react';
        export { keys } from '../api/keys';
        export * from '@/routes/app';
        const lazy = import('@/features/access/components/internal/dialog');
        import 'react-dom';
      `),
    ).toEqual([
      '@/features/access/model/access',
      'react',
      '../api/keys',
      '@/routes/app',
      '@/features/access/components/internal/dialog',
      'react-dom',
    ]);
  });

  it.each([
    'react',
    'react/jsx-runtime',
    'react-dom',
    'react-dom/client',
    '@tanstack/react-query',
    '@nibleaf/design-system/button',
    '@/services/client',
    '../../../services/client',
    '../api/keys',
    '../components/view',
    '@/features/b/api/hooks',
    '@/features/b/components/view',
    '@/components/project-settings/shared',
    '@/components/ui/form-field',
    '../../../components/ui/form-field',
    '@/hooks/api',
    '@/hooks/api/types',
    '../../../hooks/api/query-keys',
  ])('rejects impure model dependency %s', (specifier) => {
    expect(checkFeatureImports([{ file: 'features/a/model/access.ts', imports: [specifier] }])).not.toEqual([]);
  });

  it.each(['../components/view', '@/features/b/components/view', '@/components/button', '../../../components/button'])(
    'rejects API component dependency %s',
    (specifier) => {
      expect(checkFeatureImports([{ file: 'features/a/api/hooks.ts', imports: [specifier] }])).not.toEqual([]);
    },
  );

  it('allows public cross-feature entrypoints and same-feature internal components', () => {
    expect(
      checkFeatureImports([
        {
          file: 'features/a/components/view.tsx',
          imports: [
            '@/features/b/api/keys',
            '@/features/b/api/query-options.ts',
            '@/features/b/api/hooks',
            '@/features/b/api/mutations',
            '@/features/b/model/access',
            '@/features/b/model/ids.ts',
            '../../b/components/view',
            '@/features/b/components/view.tsx',
            './internal/dialog',
          ],
        },
        { file: 'features/a/model/access.ts', imports: ['./ids', '@/features/b/model/access', '@nibleaf/shared/rbac'] },
      ]),
    ).toEqual([]);
  });

  it.each([
    '@/features/b',
    '@/features/b/api/prefetch',
    '@/features/b/index.ts',
    '../../b/components/internal/dialog',
    '../../b/model/internal/access',
  ])('rejects private cross-feature entrypoint %s', (specifier) => {
    expect(checkFeatureImports([{ file: 'features/a/components/view.tsx', imports: [specifier] }])).not.toEqual([]);
  });

  it.each(['@/routes/app', '../../../routes/app'])('rejects routes from any feature file via %s', (specifier) => {
    expect(checkFeatureImports([{ file: 'features/a/lib/helper.ts', imports: [specifier] }])).toEqual([
      `features/a/lib/helper.ts -> ${specifier}: features must not import routes`,
    ]);
  });

  it('accepts an empty feature tree', () => {
    expect(checkFeatureImports([])).toEqual([]);
  });
});
