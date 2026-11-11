import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The people model is pure (operations/ui-overhaul.md §7.1): no React, no
 * design system, no API or components, no services. Permission logic lives
 * here, so components can't grow their own.
 */
const FORBIDDEN = [
  /^react(?:-dom)?(?:\/|$)/,
  /^@nibleaf\/design-system/,
  /^@tanstack\//,
  /^\.\.\/(?:api|components)\//,
  /^@\/(?:services|hooks|components|routes)\//,
];

describe('people model boundaries', () => {
  const directory = import.meta.dirname;
  const files = readdirSync(directory).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'));
  it.each(files)('%s imports only pure modules', (name) => {
    const source = readFileSync(resolve(directory, name), 'utf8');
    const imports = [...source.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1] ?? '');
    expect(imports.filter((specifier) => FORBIDDEN.some((pattern) => pattern.test(specifier)))).toEqual([]);
  });
});
