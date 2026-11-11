import { PassThrough } from 'node:stream';
import type { ReactNode } from 'react';
import { renderToPipeableStream } from 'react-dom/server.node';
import { describe, expect, it } from 'vitest';
import { MAX_HIGHLIGHT_LENGTH } from '@/components/site/reader-highlight';
import { needsRichMarkdown } from '@/lib/reader-hydration-modules';
import { Markdown } from './markdown';

/*
 * The article renderer decides which grammars and which renderer an article
 * needs with its own Markdown parser, so the server marks (and highlights)
 * exactly what the browser will hydrate.
 */

const render = (node: ReactNode): Promise<string> =>
  new Promise((resolve, reject) => {
    const output = new PassThrough();
    let html = '';
    output.on('data', (chunk) => {
      html += chunk.toString();
    });
    output.on('end', () => resolve(html));
    output.on('error', reject);
    const { pipe } = renderToPipeableStream(node, { onAllReady: () => pipe(output), onError: reject });
  });

describe('code languages, read with Markdown semantics', () => {
  it.each([
    ['a fence nested in a list and a blockquote', '- > ```rust\n  > fn main() {}\n  > ```'],
    ['an entity-encoded info string', '```r&#117;st\nfn main() {}\n```'],
  ])('highlights %s with its lazily loaded grammar', async (_, content) => {
    const html = await render(<Markdown content={content} />);
    expect(html).toContain('hljs-rust');
    expect(html).toMatch(/<span class="hljs-keyword">fn<\/span>/);
  });

  it('leaves a very long block as plain text', async () => {
    const body = 'let x = 1;\n'.repeat(Math.ceil((MAX_HIGHLIGHT_LENGTH + 10) / 11));
    const html = await render(<Markdown content={`\`\`\`js\n${body}\`\`\``} />);
    expect(html).toContain('class="hljs language-js"');
    expect(html).not.toContain('hljs-keyword');
  });
});

describe('the rich renderer after a fence a container closes', () => {
  // The blockquote ends at the blank line, and so does its fence: the math after
  // it is prose and needs KaTeX.
  const content = '> ```\n> code\n\nMath $x^2$.';

  it('loads the rich renderer in the article', async () => {
    const html = await render(<Markdown content={content} />);
    expect(html).toContain('katex');
  });

  it('errs towards the rich renderer in the loaders’ line-based check', () => {
    expect(needsRichMarkdown(content)).toBe(true);
    // Unchanged for top-level fences: math inside one isn't math.
    expect(needsRichMarkdown('```\nprice: $5 and $6\n```')).toBe(false);
  });
});
