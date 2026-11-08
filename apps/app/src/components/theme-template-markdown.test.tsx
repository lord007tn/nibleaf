import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { themeRepositoryReaderTemplateFiles } from '@nibleaf/shared/theme-repository-templates';
import { type ComponentType, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Renders authored MDX through the reader pipeline an exported GitHub theme
 * repository ships (`src/lib/markdown.tsx` and `src/components/mdx/*`), using
 * the generated files themselves. They are written under apps/app (where their
 * npm dependencies resolve) in a gitignored cache folder.
 */
const root = resolve(import.meta.dirname, '../../.cache', `theme-template-${process.pid}`);
// `src/lib/site.ts` reads the repository's docs.json and content; the
// renderer only needs its heading-id helper.
const siteStub = `export const uniqueHeadingId = (text: string, used: Map<string, number>): string => {
  const base = text.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'section';
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : base + '-' + count;
};
`;

// The repository's Paraglide build compiles its en/ar catalogs; the fields
// component reads three labels from it.
const messagesStub = `export const fieldRequired = () => 'required';
export const fieldDeprecated = () => 'deprecated';
export const fieldDefault = () => 'default';
`;

let Markdown: ComponentType<{ body: string }>;

beforeAll(async () => {
  for (const file of [
    ...themeRepositoryReaderTemplateFiles(),
    { path: 'src/lib/site.ts', content: siteStub },
    { path: 'src/paraglide/messages.js', content: messagesStub },
  ]) {
    const target = join(root, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
  }
  ({ Markdown } = (await import(/* @vite-ignore */ join(root, 'src/lib/markdown.tsx'))) as { Markdown: ComponentType<{ body: string }> });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const render = (body: string) => renderToStaticMarkup(createElement(Markdown, { body }));

describe('exported theme repository Markdown', () => {
  it.each([
    ['ParamField', '<ParamField name="page_size" type="integer">\n\nItems per page.\n\n</ParamField>', 'page_size'],
    ['ResponseField', '<ResponseField name="next_cursor" type="string">\n\nThe next page.\n\n</ResponseField>', 'next_cursor'],
    ['Folder and File', '<FileTree>\n<Folder name="src-folder">\n<File name="index-file.ts" />\n</Folder>\n</FileTree>', 'index-file.ts'],
  ])('keeps the authored %s name', (_label, body, name) => {
    const html = render(body);
    expect(html).toContain(name);
    expect(html).not.toContain(`name="${name}"`);
  });

  it.each([
    ['path', 'id'],
    ['query', 'page_size'],
    ['header', 'Authorization'],
    ['body', 'email'],
  ])('names a ParamField by its %s prop like the reader', (location, name) => {
    expect(render(`<ParamField ${location}="${name}" type="string" required>\n\nText.\n\n</ParamField>`)).toContain(`<code dir="ltr">${name}</code>`);
  });

  it('shows when a field is required or deprecated, and its default, like the reader (#338)', () => {
    const html = render('<ParamField query="limit" type="integer" required default="20" deprecated>\n\nPage size.\n\n</ParamField>');
    expect(html).toContain('integer · required · deprecated · default: <code dir="ltr">20</code>');
    expect(render('<ResponseField name="id" type="string">\n\nText.\n\n</ResponseField>')).not.toMatch(/deprecated|default:/);
  });

  it('lets only a plain color reach an Icon style, and reads a {24} size', () => {
    expect(render('<Icon icon="star" color="#0ea5e9" size={24} />')).toMatch(/style="color:#0ea5e9;font-size:24px"/);
    expect(render('<Icon icon="star" color="red;position:fixed;inset:0" />')).not.toMatch(/position|inset/);
  });

  it('still strips script', () => {
    expect(render('<ResponseField name="x" onclick="alert(1)">\n\nText\n\n</ResponseField>\n\n<script>alert(1)</script>')).not.toMatch(
      /onclick|<script/,
    );
  });

  it.each([
    ['3', 3],
    ['4', 4],
    ['1', 1],
    ['9', 2],
    ['', 2],
    ['{3}', 3],
    ['{4}', 4],
    ['{n}', 2],
  ])('lays a CardGroup with cols=%s out in %i columns', (cols, count) => {
    const value = cols.startsWith('{') ? cols : `"${cols}"`;
    const html = render(`<CardGroup cols=${value}>\n<Card title="One">First</Card>\n</CardGroup>`);
    expect(html).toContain(`data-cols="${count}"`);
    expect(html).toContain(`--mdx-cols:${count}`);
  });

  it.each([
    ['Accordion', '<Accordion title="More" defaultOpen{value}>\n\nHidden text.\n\n</Accordion>'],
    ['ParamField', '<ParamField name="limit" type="integer" required{value}>\n\nItems per page.\n\n</ParamField>'],
  ])('reads a JSX {true} on %s like a bare boolean and {false} like an absent one', (_label, template) => {
    const usage = (value: string) => render(template.replace('{value}', value));
    expect(usage('={true}')).toBe(usage(''));
    expect(usage('={false}')).not.toBe(usage(''));
    expect(usage('={false}')).toBe(render(template.replace(/ (?:defaultOpen|required)\{value\}/, '')));
  });

  it('defaults a CardGroup without cols to two columns', () => {
    expect(render('<CardGroup>\n<Card title="One">First</Card>\n</CardGroup>')).toContain('data-cols="2"');
  });

  it('keeps underline, subscript and superscript like the reader', () => {
    const html = render('A <u>underlined</u> word, H<sub>2</sub>O and x<sup>2</sup>.');
    expect(html).toContain('<u>underlined</u>');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
  });
});
