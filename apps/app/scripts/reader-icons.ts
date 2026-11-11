import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/*
 * The Lucide icons a published docs page renders, grouped into two chunks.
 *
 * Rolldown groups a shared module by the set of chunks that import it, and most
 * icons the reader uses are also used by some dashboard or marketing chunk. So
 * each became a chunk of its own: about 45 icon-only files of ~0.2 KiB that
 * every docs page preloaded, each paying its own request and gzip header.
 */

/** Reader icons that marketing code also imports, as of main@88daac87. Keeping
 *  them in their own group keeps marketing's own icon imports from re-splitting
 *  the reader's icon chunks; `bundle:check` fails on any other reader icon in a
 *  chunk marketing code imports (see `marketingSharedReaderIcons`). */
export const KNOWN_MARKETING_READER_ICONS: ReadonlySet<string> = new Set([
  'book-open',
  'chart-column',
  'check',
  'circle-question-mark',
  'clock',
  'cloud',
  'compass',
  'external-link',
  'globe',
  'languages',
  'life-buoy',
  'link-2',
  'menu',
  'moon',
  'palette',
  'pen-line',
  'search',
  'server',
  'sparkles',
  'sun',
  'terminal',
  'users',
  'x',
]);

/** Reader modules on the first load of a published docs page that import
 *  icons. Icons of lazily loaded reader code (search dialog, chat, article
 *  renderer, header menus) stay with that code. */
const READER_ICON_SOURCES = [
  'src/components/site/page-icon.tsx',
  'src/components/site/site-nav.tsx',
  'src/components/site/mobile-nav.tsx',
  'src/components/site/language-switcher.tsx',
  'src/components/site/version-switcher.tsx',
  'src/components/site/site-banner.tsx',
  'src/components/site/site-page-view.tsx',
  'src/components/site/toc.tsx',
  'src/components/site/site-not-found.tsx',
  'src/components/site/site-search.tsx',
  'src/routes/sites/$projectId/route.tsx',
  'src/routes/sites/$projectId/changelog.tsx',
];

const LUCIDE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g;
const LUCIDE_EXPORT = /export \{([^}]*)\} from '\.\/icons\/([\w-]+)\.mjs'/g;
const ICON_MODULE = /\/node_modules\/lucide-react\/dist\/esm\/icons\/([\w-]+)\.mjs$/;

/** Icon file names (`chevron-right`) the reader's first-load modules import. */
export function readerIconFiles(appRoot: string): Set<string> {
  // Every export name and alias (`HelpCircle`, `CircleHelpIcon`) to its file.
  const lucideEntry = createRequire(join(appRoot, 'package.json')).resolve('lucide-react');
  const index = readFileSync(join(dirname(lucideEntry), '../esm/lucide-react.mjs'), 'utf8');
  const fileOf = new Map<string, string>();
  for (const [, names = '', file = ''] of index.matchAll(LUCIDE_EXPORT)) {
    for (const name of names.split(',')) fileOf.set(name.trim().replace(/^default as /, ''), file);
  }
  const files = new Set<string>();
  for (const source of READER_ICON_SOURCES) {
    for (const [, specifiers = ''] of readFileSync(join(appRoot, source), 'utf8').matchAll(LUCIDE_IMPORT)) {
      for (const specifier of specifiers.split(',')) {
        const name = specifier
          .trim()
          .split(/\s+as\s+/)[0]
          ?.trim();
        if (!name || name.startsWith('type ')) continue;
        const file = fileOf.get(name);
        if (!file) throw new Error(`${source} imports ${name} from lucide-react, which its ESM index doesn't export.`);
        files.add(file);
      }
    }
  }
  return files;
}

/** Rolldown groups for the reader's icons: the ones marketing shares, and the rest. */
export function readerIconGroups(appRoot: string) {
  const files = readerIconFiles(appRoot);
  const iconOf = (id: string) => ICON_MODULE.exec(id.replaceAll('\\', '/'))?.[1];
  return [
    {
      name: 'site-icons',
      minSize: 0,
      test: (id: string) => {
        const icon = iconOf(id);
        return icon !== undefined && files.has(icon) && !KNOWN_MARKETING_READER_ICONS.has(icon);
      },
    },
    {
      name: 'site-shared-icons',
      minSize: 0,
      test: (id: string) => {
        const icon = iconOf(id);
        return icon !== undefined && files.has(icon) && KNOWN_MARKETING_READER_ICONS.has(icon);
      },
    },
  ];
}
