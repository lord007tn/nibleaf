// @vitest-environment jsdom
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import rehypeRaw from 'rehype-raw';
import { afterAll, describe, expect, it } from 'vitest';
import { Markdown, MarkdownRenderer } from '../markdown';
import RichMarkdown from '../markdown-rich';

const dimensions = { '/known.png': { width: 1313, height: 900 }, '/other.png': { width: 950, height: 600 } };

describe('reader image dimensions', () => {
  it.each([false, true])('emits known sizes through sanitizer and both img renderers (site=%s)', (site) => {
    const html = renderToString(
      <Markdown content={'![](/known.png)\n\n![](/missing.png)'} imageDimensions={dimensions} site={site ? { projectId: 'p' } : undefined} />,
    );
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('img[src="/known.png"]')?.outerHTML).toContain('width="1313" height="900"');
    expect(container.querySelector('img[src="/missing.png"]')?.hasAttribute('width')).toBe(false);
    expect(container.querySelector('img[src="/missing.png"]')?.hasAttribute('height')).toBe(false);
  });

  it('keeps authored pairs and single dimensions, appearance variants and tiny icons', () => {
    const html = renderToString(
      <RichMarkdown
        content={
          '<img src="/known.png" width="24" height="16" />\n\n<img src="/known.png" width="300" class="dark:hidden" />\n\n<img src="/other.png" class="hidden dark:block" />'
        }
        imageDimensions={dimensions}
        site={{ projectId: 'p' }}
      />,
    );
    const container = document.createElement('div');
    container.innerHTML = html;
    const images = [...container.querySelectorAll('img')];
    expect(images.map((image) => [image.getAttribute('width'), image.getAttribute('height'), image.getAttribute('loading')])).toEqual([
      ['24', '16', 'lazy'],
      ['300', null, 'eager'],
      ['950', '600', 'eager'],
    ]);
    expect(images[1]?.className).toContain('dark:hidden');
    expect(images[2]?.className).toContain('hidden dark:block');
  });

  it.each([false, true])('hydrates the exact SSR dimensions without recovery (rich=%s)', async (rich) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const node = (
      <MarkdownRenderer
        content={rich ? '<img src="/known.png" />' : '![](/known.png)'}
        imageDimensions={dimensions}
        site={{ projectId: 'p' }}
        extraRehypePlugins={rich ? [rehypeRaw] : []}
      />
    );
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = renderToString(node);
    const before = container.innerHTML;
    const errors: unknown[] = [];
    const root = hydrateRoot(container, node, { onRecoverableError: (error) => errors.push(error) });
    await act(async () => {
      // Flush hydration effects before comparing the client and SSR markup.
    });
    expect(errors).toEqual([]);
    expect(container.innerHTML).toBe(before);
    expect(container.querySelector('img')?.width).toBe(1313);
    await act(async () => root.unmount());
    container.remove();
  });

  afterAll(() => {
    const output = process.env.IMAGE_DIMENSIONS_FIXTURE;
    if (!output) return;
    mkdirSync(output, { recursive: true });
    const sizes: [number, number][] = [
      [1313, 900],
      [950, 600],
      [1200, 750],
      [1100, 660],
      [1000, 700],
    ];
    const imageDimensions = Object.fromEntries(sizes.map(([width, height], n) => [`/fixture-${n}.svg`, { width, height }]));
    for (const lang of ['en', 'ar']) {
      const text = lang === 'ar' ? 'دليل إعداد الفندق' : 'Hotel setup guide';
      const content = `# ${text}\n\n${text}.\n\n${sizes.map((_, n) => `![${text}](/fixture-${n}.svg)\n\n## ${text} ${n + 1}\n\n${text}.`).join('\n\n')}`;
      for (const mode of ['before', 'after']) {
        const html = renderToString(
          <Markdown content={content} imageDimensions={mode === 'after' ? imageDimensions : undefined} site={{ projectId: 'fixture', lang }} />,
        );
        writeFileSync(join(output, `${lang}-${mode}.html`), html);
      }
    }
    writeFileSync(join(output, 'sizes.json'), JSON.stringify(sizes));
  });
});
