import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/markdown';

const render = (content: string): string => renderToStaticMarkup(createElement(Markdown, { content }));

describe('Markdown renderer — Mintlify component parity', () => {
  it('renders KaTeX for inline and block math', () => {
    const html = render('Inline $a^2+b^2=c^2$ and a block:\n\n$$\\int_0^1 x\\,dx$$');
    expect(html).toContain('katex');
  });

  it('draws a filename header from a code fence title= meta', () => {
    const html = render('```js title="server.js"\nconsole.log(1)\n```');
    expect(html).toContain('server.js');
  });

  it('renders ParamField with name, type and a required badge', () => {
    const html = render('<ParamField path="userId" type="string" required>\nThe user id.\n</ParamField>');
    expect(html).toContain('userId');
    expect(html).toContain('string');
    expect(html.toLowerCase()).toContain('required');
  });

  it('renders ResponseField name + type', () => {
    const html = render('<ResponseField name="created_at" type="number">\nUnix timestamp.\n</ResponseField>');
    expect(html).toContain('created_at');
    expect(html).toContain('number');
  });

  it('renders an Expandable with its title', () => {
    const html = render('<Expandable title="Nested properties">\nhidden detail\n</Expandable>');
    expect(html).toContain('Nested properties');
  });

  it('renders CodeGroup as tabs labelled per block', () => {
    const html = render('<CodeGroup>\n\n```js title="a.js"\n1\n```\n\n```py title="b.py"\n2\n```\n\n</CodeGroup>');
    expect(html).toContain('a.js');
    expect(html).toContain('b.py');
  });

  it('renders an inline Icon as an svg', () => {
    const html = render('Click <Icon icon="rocket" /> to launch');
    expect(html).toContain('<svg');
  });

  it('renders an Update changelog label', () => {
    const html = render('<Update label="v1.2.0">\nShipped things.\n</Update>');
    expect(html).toContain('v1.2.0');
  });

  it('hands a ```mermaid fence to the client block (raw source, never highlighted)', () => {
    const html = render('```mermaid\ngraph TD; A-->B;\n```');
    expect(html).toContain('graph TD');
    // rehypeMermaid replaces the fence before rehype-highlight runs.
    expect(html).not.toContain('language-mermaid');
  });

  it('still renders pre-existing components (Card, Callout)', () => {
    expect(render('<Card title="Hello">body</Card>')).toContain('Hello');
    expect(render('> [!WARNING]\n> be careful')).toContain('be careful');
  });
});
