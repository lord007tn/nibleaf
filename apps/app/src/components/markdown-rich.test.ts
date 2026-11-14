/** @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readerRenderMode } from '@nibleaf/shared/reader-render-mode';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  articleRendererModules,
  loadArticleRenderer,
  mathMarkdownModule,
  needsRichMarkdown,
  richMarkdownModule,
} from '@/lib/reader-hydration-modules';
import { mathPlugins } from './markdown-math';
import RichMarkdown from './markdown-rich';

describe('conditional Markdown renderer', () => {
  it('keeps ordinary GFM on the lightweight renderer', () => {
    expect(needsRichMarkdown('# Hello\n\n- one\n- two\n\n```ts\nconst x = 1\n```')).toBe(false);
  });

  it.each(['Inline $x^2$ math', '$$\\frac{a}{b}$$', '<Callout type="tip">Useful</Callout>', '<table><tr><td>Raw</td></tr></table>'])(
    'uses the SSR-capable rich renderer for %s',
    (content) => expect(needsRichMarkdown(content)).toBe(true),
  );

  it.each([
    '<Note>Hi</Note>\n\n$`x$`',
    '<Note>Hi</Note>\n\n$[x](https://example.com/$)',
    '<Note>Hi</Note>\n\n$<span title="$">',
    '<code class="math&#0000000045;inline">x^2</code>',
  ])('detects math wherever the rich renderer typesets it: %s', (content) => {
    expect(readerRenderMode(content)).toMatchObject({ rich: true, math: true });
    expect(renderToStaticMarkup(createElement(RichMarkdown, { content, math: mathPlugins }))).toContain('class="katex"');
  });

  it('loads what the renderer decides before a navigation, even where the line scan guessed no math', async () => {
    // Normalization joins the class into math-inline; past the parser bounds the
    // renderer gives this rich page KaTeX, while the line scan sees no math.
    const content = `<code class="ma{/* note */}th-inline">x^2</code>\n\n${'word '.repeat(80_001)}`;
    expect(articleRendererModules(content)).toEqual([richMarkdownModule]);
    expect(readerRenderMode(content)).toMatchObject({ rich: true, math: true });
    expect(mathMarkdownModule.status()).toBe('idle');
    await loadArticleRenderer(content);
    // The island would wait on both; both are in before the page renders.
    expect(mathMarkdownModule.status()).toBe('loaded');
    expect(richMarkdownModule.status()).toBe('loaded');
  });

  it('preloads KaTeX only with the rich renderer, never for a code-only page', () => {
    expect(articleRendererModules('Run `echo $HOME and $PATH`.\n\nUse `math-inline` in CSS.')).toEqual([]);
    expect(articleRendererModules('<Note>Hi</Note>\n\n$`x$`')).toEqual([richMarkdownModule, mathMarkdownModule]);
    expect(articleRendererModules('<Note>Hi</Note>')).toEqual([richMarkdownModule]);
  });

  it('does not mistake escaped dollar signs for math', () => {
    expect(needsRichMarkdown('The plan costs \\$5 per month.')).toBe(false);
  });

  it('preserves code math markers through sanitization before generating accessible KaTeX markup', () => {
    const html = renderToStaticMarkup(
      createElement(RichMarkdown, {
        content: '<code class="math-inline" style="position:fixed" onclick="alert(1)">\\frac{1}{2}</code>',
        math: mathPlugins,
      }),
    );
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">');
    expect(html).toContain('<annotation encoding="application/x-tex">\\frac{1}{2}</annotation>');
    expect(html).toContain('class="katex-html" aria-hidden="true"');
    expect(html).toContain('style="height:');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('onclick');
  });

  it('typesets an entity-encoded math class, which the page detector now loads KaTeX for', () => {
    const content = '<Note>Hi</Note>\n\n<code class="math&#45;inline">\\frac{1}{2}</code>';
    expect(readerRenderMode(content)).toMatchObject({ rich: true, math: true });
    const html = renderToStaticMarkup(createElement(RichMarkdown, { content, math: mathPlugins }));
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">');
  });

  it('renders fenced math as display math using the same sanitized pipeline', () => {
    const html = renderToStaticMarkup(createElement(RichMarkdown, { content: '```math\n\\sqrt{x^2+1}\n```', math: mathPlugins }));
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="katex-mathml"');
    expect(html).toContain('class="katex-html" aria-hidden="true"');
    expect(html).not.toContain('language-math');
  });

  it("keeps the editor's underline, subscript and superscript", () => {
    const html = renderToStaticMarkup(createElement(RichMarkdown, { content: 'A <u>underlined</u> word, H<sub>2</sub>O and x<sup>2</sup>.' }));
    expect(html).toContain('<u>underlined</u>');
    expect(html).toContain('<sub>2</sub>');
    expect(html).toContain('<sup>2</sup>');
    // Allowed like any inline element: no handlers or styles.
    const styled = renderToStaticMarkup(createElement(RichMarkdown, { content: '<u style="color:red" onclick="alert(1)">x</u>' }));
    expect(styled).toContain('<u>x</u>');
  });
});

describe('KaTeX loads only for math (PUB-017)', () => {
  it('keeps KaTeX, its stylesheet and the math syntax out of the rich renderer', () => {
    const source = readFileSync(resolve(import.meta.dirname, 'markdown-rich.tsx'), 'utf8');
    expect(source).not.toMatch(/from 'rehype-katex'|from 'remark-math'|katex\.min\.css/);
    const math = readFileSync(resolve(import.meta.dirname, 'markdown-math.ts'), 'utf8');
    expect(math).toMatch(/from 'rehype-katex'/);
    expect(math).toMatch(/katex\.min\.css/);
  });

  it('renders math as plain text when the page did not ask for KaTeX', () => {
    const html = renderToStaticMarkup(createElement(RichMarkdown, { content: '<Note>Hi</Note>' }));
    expect(html).not.toContain('katex');
  });
});

// Last: it resets the module graph, so later dynamic imports would see fresh modules.
describe('preview page switches', () => {
  it('keeps the current page on screen while KaTeX loads for a newly selected math page (previews have no loader)', async () => {
    vi.resetModules();
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { Markdown } = await import('./markdown');
    const modules = await import('@/lib/reader-hydration-modules');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await modules.articleMarkdownModule.load();
    await modules.richMarkdownModule.load();
    expect(modules.mathMarkdownModule.status()).toBe('idle');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(createElement(Markdown, { content: '<Note>First page</Note>' })));
    expect(host.textContent).toContain('First page');
    // Select a page with math: no raw TeX while KaTeX is still loading.
    act(() => root.render(createElement(Markdown, { content: '<Note>Second page</Note>\n\nThe area is $x^2$.' })));
    expect(host.textContent).not.toContain('$x^2$');
    expect(host.textContent).toContain('First page');
    await act(async () => {
      await modules.mathMarkdownModule.load();
    });
    await act(async () => undefined);
    expect(host.querySelector('.katex')).not.toBeNull();
    expect(host.textContent).toContain('Second page');
    act(() => root.unmount());
    host.remove();
  });

  it('holds a freshly mounted math page until KaTeX is in (the preview between its skeleton and the page)', async () => {
    vi.resetModules();
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { useMathReady } = await import('./markdown');
    const modules = await import('@/lib/reader-hydration-modules');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await modules.richMarkdownModule.load();
    expect(modules.mathMarkdownModule.status()).toBe('idle');
    const seen: boolean[] = [];
    const Probe = ({ content }: { content: string }) => {
      seen.push(useMathReady(content));
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    // A rich page without math, then (after the skeleton) a fresh mount of one with math.
    act(() => root.render(createElement(Probe, { content: '<Note>No math</Note>' })));
    expect(seen.at(-1)).toBe(true);
    act(() => root.render(null));
    seen.length = 0;
    act(() => root.render(createElement(Probe, { content: '<Note>Hi</Note>\n\nThe area is $x^2$.' })));
    expect(seen[0]).toBe(false);
    await act(async () => {
      await modules.mathMarkdownModule.load();
    });
    await act(async () => undefined);
    expect(seen.at(-1)).toBe(true);
    act(() => root.unmount());
  });

  it('waits for KaTeX on a fresh client mount of a math page, in any view (a git preview after an empty scope)', async () => {
    vi.resetModules();
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { Markdown } = await import('./markdown');
    const modules = await import('@/lib/reader-hydration-modules');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await modules.articleMarkdownModule.load();
    await modules.richMarkdownModule.load();
    expect(modules.mathMarkdownModule.status()).toBe('idle');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    // A rich page, then nothing (an empty language/version scope), then a math page mounted fresh.
    await act(async () => root.render(createElement(Markdown, { content: '<Note>English v1</Note>' })));
    act(() => root.render(null));
    act(() => root.render(createElement(Markdown, { content: '<Note>Arabic v2</Note>\n\nThe area is $x^2$.' })));
    expect(host.textContent).not.toContain('$x^2$');
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => {
      await modules.mathMarkdownModule.load();
    });
    await act(async () => undefined);
    expect(host.querySelector('.katex')).not.toBeNull();
    expect(host.textContent).toContain('Arabic v2');
    act(() => root.unmount());
    host.remove();
  });
});
