import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every Markdown page in the repository, by name: tracked .md/.mdx files (docs,
 * blog, guides, fixtures, READMEs), the starter pages in every locale, and the
 * multi-line strings of the shared JSON fixtures (component examples). Read by
 * the fence corpus test and by the script that records main's output for it
 * (`__fixtures__/markdown-code.corpus.generate.mjs`). Test-only.
 */
export const markdownCorpus = (root: string): Array<[name: string, source: string]> => {
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  const documents: Array<[string, string]> = execFileSync('git', ['ls-files', '-z', '--', '*.md', '*.mdx'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  })
    .split('\0')
    .filter(Boolean)
    .map((path) => [path, read(path)]);
  for (const file of readdirSync(join(root, 'packages/i18n/messages'))
    .filter((name) => name.endsWith('.json'))
    .sort()) {
    const messages = JSON.parse(read(`packages/i18n/messages/${file}`)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(messages))
      if (/^newsite_starter_\w+_content$/.test(key) && typeof value === 'string') documents.push([`${file}#${key}`, value]);
  }
  const starter = /STARTER_GETTING_STARTED_CONTENT = `([^`]*)`/.exec(read('packages/auth/src/starter-content.ts'))?.[1];
  if (starter) documents.push(['packages/auth/src/starter-content.ts#STARTER_GETTING_STARTED_CONTENT', starter]);
  const strings = (value: unknown, at: string): void => {
    if (typeof value === 'string' && value.includes('\n')) documents.push([at, value]);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) strings(child, `${at}.${key}`);
  };
  for (const file of readdirSync(join(root, 'packages/shared/src/__fixtures__'))
    .filter((name) => name.endsWith('.json') && !name.startsWith('markdown-code.corpus'))
    .sort())
    strings(JSON.parse(read(`packages/shared/src/__fixtures__/${file}`)), `packages/shared/src/__fixtures__/${file}`);
  return documents;
};
