import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isDashboardLocaleRouteId } from './dashboard-locale-routes';

/*
 * The browser holds only English and the prepared interface locale. These source
 * checks keep every other lookup away from that catalog: anything naming another
 * language uses named messages, and every route reaching the translator prepares
 * its language first. Value imports count even when written `{ type X, y }`.
 */
const src = resolve(import.meta.dirname, '..');
const routesDir = join(src, 'routes');

/*
 * Each route's import walk revisits most of the app. The walks used to stat and read
 * every file again, ~37k synchronous fs calls per run, which took over 5 s per test
 * under a full-suite load (#913). Now the tree is listed once, and each file is read
 * and its imports resolved once.
 */
const walk = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const memo = <T>(compute: (key: string) => T) => {
  const cache = new Map<string, T>();
  return (key: string): T => {
    if (!cache.has(key)) cache.set(key, compute(key));
    return cache.get(key) as T;
  };
};
const allFiles = walk(src);
const filesInSrc = new Set(allFiles);
const isFile = memo((path) => (path.startsWith(src + sep) ? filesInSrc.has(path) : existsSync(path) && statSync(path).isFile()));
const sourceOf = memo((file) => readFileSync(file, 'utf8'));
const isSource = (file: string) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !/[\\/]test-setup[\\/]/.test(file);
const display = (file: string) => relative(src, file).replaceAll('\\', '/');

const IMPORTS =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const FULL_TRANSLATOR = /^@nibleaf\/i18n(?:\/react)?$/;

const resolved = new Map<string, string | undefined>();
function resolveImport(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith('@/') ? join(src, specifier.slice(2)) : specifier.startsWith('.') ? resolve(dirname(from), specifier) : undefined;
  if (!base) return undefined;
  if (!resolved.has(base)) resolved.set(base, ['', '.ts', '.tsx', '/index.ts', '/index.tsx'].map((suffix) => resolve(base + suffix)).find(isFile));
  return resolved.get(base);
}

const importsOf = memo((file) =>
  [...sourceOf(file).matchAll(IMPORTS)].filter((match) => !match[1]).map((match) => (match[2] ?? match[3] ?? match[4]) as string),
);

/** The first import chain from `route` to the full translator, static or lazy. */
function chainToTranslator(route: string, forbidden = FULL_TRANSLATOR): string[] | undefined {
  const parents = new Map<string, string | null>([[route, null]]);
  const queue = [route];
  for (const file of queue) {
    for (const specifier of importsOf(file)) {
      if (forbidden.test(specifier)) {
        const chain = [specifier];
        for (let current: string | null | undefined = file; current; current = parents.get(current)) chain.unshift(display(current));
        return chain;
      }
      const target = resolveImport(file, specifier);
      if (target && /\.tsx?$/.test(target) && !parents.has(target)) {
        parents.set(target, file);
        queue.push(target);
      }
    }
  }
  return undefined;
}

/** The id a route file declares; the root route declares none. */
const routeIdOf = (file: string): string | undefined => /createFileRoute\('([^']+)'\)/.exec(sourceOf(file))?.[1];

const routeFiles = allFiles.filter(
  (file) =>
    file.startsWith(routesDir + sep) &&
    isSource(file) &&
    !relative(routesDir, file)
      .split(/[\\/]/)
      .some((part) => part.startsWith('-')),
);

/** The argument count of each `translateFn(...)` call in `source`. */
function translateFnCalls(source: string): Array<{ argumentCount: number; text: string }> {
  const calls: Array<{ argumentCount: number; text: string }> = [];
  for (const match of source.matchAll(/\btranslateFn\(/g)) {
    const start = match.index + match[0].length;
    let depth = 0;
    let commas = 0;
    let quote = '';
    let end = start;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === '\\') end += 1;
        else if (character === quote) quote = '';
      } else if (character === "'" || character === '"' || character === '`') quote = character;
      else if ('([{'.includes(character as string)) depth += 1;
      else if (character === ')' && depth === 0) break;
      else if (')]}'.includes(character as string)) depth -= 1;
      else if (character === ',' && depth === 0) commas += 1;
    }
    calls.push({ argumentCount: commas + 1, text: source.slice(match.index, end + 1) });
  }
  return calls;
}

describe('dashboard catalog boundary', () => {
  it('counts translateFn arguments correctly', () => {
    expect(translateFnCalls("translateFn('a', { b: [1, 2] }, 'ar'); translateFn(x ? 'a,' : 'b')").map((call) => call.argumentCount)).toEqual([3, 1]);
  });

  it('never passes a locale to translateFn in application code', () => {
    const offenders = allFiles.filter(isSource).flatMap((file) =>
      translateFnCalls(sourceOf(file))
        .filter((call) => call.argumentCount > 2)
        .map((call) => `${display(file)}: ${call.text}`),
    );
    expect(offenders).toEqual([]);
  });

  it('prepares the interface catalog on every route that can reach the translator', () => {
    const unprepared = routeFiles.flatMap((file) => {
      const chain = chainToTranslator(file);
      const routeId = routeIdOf(file);
      return chain && routeId && !isDashboardLocaleRouteId(routeId) ? [`${routeId}: ${chain.join(' > ')}`] : [];
    });
    expect(unprepared).toEqual([]);
  });

  it('keeps the translator out of marketing, auth and published-site routes', () => {
    const roots = routeFiles.filter((file) =>
      /^(?:index\.tsx|\$page\.tsx|ar[\\/]|blog\.|compare[\\/]|alternatives[\\/]|tools[\\/]|use-cases[\\/]|sites[\\/]|\(auth\)[\\/])/.test(
        relative(routesDir, file),
      ),
    );
    expect(roots.length).toBeGreaterThan(10);
    const authCatalog = /^@nibleaf\/i18n(?:\/(?:react|messages))?$/;
    const chains = roots.flatMap((file) => {
      const forbidden = relative(routesDir, file).split(sep)[0] === '(auth)' ? authCatalog : FULL_TRANSLATOR;
      return chainToTranslator(file, forbidden) ?? [];
    });
    expect(chains).toEqual([]);
  });

  it.each([
    'app/route.tsx',
    'git-preview.$token.tsx',
    'welcome.name.tsx',
    'oauth.consent.tsx',
    'oauth.project.tsx',
    'accept-invite.$invitationId.tsx',
    'join.$token.tsx',
  ])('%s waits for its language before rendering', (file) => {
    expect(isDashboardLocaleRouteId(routeIdOf(join(routesDir, file)) ?? '')).toBe(true);
    const source = readFileSync(join(routesDir, file), 'utf8');
    expect(source).toMatch(/await loadRouteDashboardLocale\(preload\)/);
    expect(source).toMatch(/dashboardLocale: true/);
  });
});
