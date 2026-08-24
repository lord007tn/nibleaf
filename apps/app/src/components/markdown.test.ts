import { PassThrough } from 'node:stream';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from '@/components/markdown';

const render = (content: string, language?: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk));
    output.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    output.on('error', reject);
    const stream = renderToPipeableStream(
      createElement(Markdown, {
        content,
        site: language ? { projectId: 'reader-test', lang: language } : undefined,
      }),
      {
        onAllReady: () => stream.pipe(output),
        onError: reject,
      },
    );
  });

describe('Markdown renderer — Mintlify component parity', () => {
  it('renders KaTeX for inline and block math', async () => {
    const html = await render('Inline $a^2+b^2=c^2$ and a block:\n\n$$\\int_0^1 x\\,dx$$');
    expect(html).toContain('katex');
  });

  it('draws a filename header from a code fence title= meta', async () => {
    const html = await render('```js title="server.js"\nconsole.log(1)\n```');
    expect(html).toContain('server.js');
  });

  it('renders ParamField with name, type and a required badge', async () => {
    const html = await render('<ParamField path="userId" type="string" required>\nThe user id.\n</ParamField>');
    expect(html).toContain('userId');
    expect(html).toContain('string');
    expect(html.toLowerCase()).toContain('required');
  });

  it('renders ResponseField name + type', async () => {
    const html = await render('<ResponseField name="created_at" type="number">\nUnix timestamp.\n</ResponseField>');
    expect(html).toContain('created_at');
    expect(html).toContain('number');
  });

  it('renders an Expandable with its title', async () => {
    const html = await render('<Expandable title="Nested properties">\nhidden detail\n</Expandable>');
    expect(html).toContain('Nested properties');
  });

  it('renders CodeGroup as tabs labelled per block', async () => {
    const html = await render('<CodeGroup>\n\n```js title="a.js"\n1\n```\n\n```py title="b.py"\n2\n```\n\n</CodeGroup>');
    expect(html).toContain('a.js');
    expect(html).toContain('b.py');
  });

  it('renders authored file trees without treating names as repository paths', async () => {
    const html = await render(
      '<FileTree>\n  <Folder name="src" defaultOpen>\n    <File name="index.ts" icon="file-code" />\n    <File name="types.ts" />\n  </Folder>\n</FileTree>',
    );
    expect(html).toContain('data-theme-component="file-tree"');
    expect(html).toContain('src');
    expect(html).toContain('index.ts');
    expect(html).toContain('types.ts');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('<ul><p><li');
    expect(html).not.toContain('&lt;File');
  });

  it('renders authored request and response examples with safe metadata', async () => {
    const html = await render(
      '<ApiExample title="Create item">\n<RequestExample title="Request">\n`POST /items`\n</RequestExample>\n<ResponseExample title="Response" status="201">\nCreated.\n</ResponseExample>\n</ApiExample>',
    );
    expect(html).toContain('data-theme-component="api-example"');
    expect(html).toContain('data-example-kind="request"');
    expect(html).toContain('data-example-kind="response"');
    expect(html).toContain('Create item');
    expect(html).toContain('201');
  });

  it('renders related cards and rewrites their internal links to the published site base', async () => {
    const html = await render(
      '<RelatedContent title="Continue reading">\n  <RelatedCard title="Authentication" description="Secure the API" href="/authentication" icon="key" />\n  <RelatedCard title="Errors" description="Handle failures" href="/errors" />\n</RelatedContent>',
      'en',
    );
    expect(html).toContain('data-theme-component="related-content"');
    expect(html).toContain('Authentication');
    expect(html).toContain('Secure the API');
    expect(html).toContain('href="/sites/reader-test/authentication?lang=en"');
    expect(html).toContain('href="/sites/reader-test/errors?lang=en"');
    expect(html).not.toMatch(/<a[^>]*>\s*<a/i);
  });

  it('strips unsafe attributes and URL protocols from authored components', async () => {
    const html = await render(
      '<RelatedContent title="Safe">\n<RelatedCard title="Unsafe target" href="javascript:alert(1)" onclick="alert(2)" data-secret="snapshot" />\n</RelatedContent>',
    );
    expect(html).toContain('Unsafe target');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('data-secret');
  });

  it('keeps Banner portable by stripping unsupported dismissal metadata', async () => {
    const html = await render('<Banner type="warning" dismissible>Important update.</Banner>');
    expect(html).toContain('Important update.');
    expect(html).not.toContain('dismissible');
  });

  it('connects tab, accordion, expandable, and code-group controls to their panels', async () => {
    const html = await render(
      '<Tabs>\n<Tab title="One">First</Tab>\n<Tab title="Two">Second</Tab>\n</Tabs>\n<Accordion title="Details">Inside</Accordion>\n<Expandable title="Properties">Nested</Expandable>\n<CodeGroup>\n\n```js title="one.js"\n1\n```\n\n```js title="two.js"\n2\n```\n\n</CodeGroup>',
    );
    expect(html.match(/role="tablist"/g)).toHaveLength(2);
    const renderedTabs = html.match(/role="tab"/g) ?? [];
    expect(renderedTabs.length).toBeGreaterThanOrEqual(3);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(renderedTabs.length);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('aria-labelledby=');
  });

  it('renders an inline Icon as an svg', async () => {
    const html = await render('Click <Icon icon="rocket" /> to launch');
    expect(html).toContain('<svg');
  });

  it('renders an Update changelog label', async () => {
    const html = await render('<Update label="v1.2.0">\nShipped things.\n</Update>');
    expect(html).toContain('v1.2.0');
  });

  it('hands a ```mermaid fence to the client block (raw source, never highlighted)', async () => {
    const html = await render('```mermaid\ngraph TD; A-->B;\n```');
    expect(html).toContain('graph TD');
    // rehypeMermaid replaces the fence before rehype-highlight runs.
    expect(html).not.toContain('language-mermaid');
  });

  it('still renders pre-existing components (Card, Callout)', async () => {
    expect(await render('<Card title="Hello">body</Card>')).toContain('Hello');
    expect(await render('> [!WARNING]\n> be careful')).toContain('be careful');
  });

  it('parses Markdown children inside an authored Callout component', async () => {
    const html = await render('<Callout type="tip">\n**Bold guidance** with [details](/guide).\n</Callout>', 'en');
    expect(html).toContain('data-theme-component="callout"');
    expect(html).toContain('<strong>Bold guidance</strong>');
    expect(html).toContain('href="/sites/reader-test/guide?lang=en"');
  });

  it('localizes code controls and default MDX labels for an Arabic reader', async () => {
    const html = await render(
      [
        '```text',
        'copy me',
        '```',
        '',
        '<Accordion>',
        'تفاصيل داخلية',
        '</Accordion>',
        '',
        '<Tabs>',
        '<Tab>',
        'المحتوى',
        '</Tab>',
        '</Tabs>',
        '',
        '<ParamField name="status" type="string" required deprecated default="ready">',
        'وصف',
        '</ParamField>',
        '',
        '<Expandable>',
        'خاصية داخلية',
        '</Expandable>',
      ].join('\n'),
      'ar-SA',
    );

    expect(html).toContain('aria-label="نسخ الشيفرة"');
    expect(html).toContain('التفاصيل');
    expect(html).toContain('علامة التبويب 1');
    expect(html).toContain('مطلوب');
    expect(html).toContain('مهمل');
    expect(html).toContain('الافتراضي');
    expect(html).toContain('عرض الخصائص');
  });

  it('preserves English MDX defaults when no site language is supplied', async () => {
    const html = await render(
      '<Accordion>\ninside\n</Accordion>\n\n<Tabs>\n<Tab>\ncontent\n</Tab>\n</Tabs>\n\n<Expandable>\nproperty\n</Expandable>',
    );
    expect(html).toContain('Details');
    expect(html).toContain('Tab 1');
    expect(html).toContain('Show properties');
  });

  it('localizes the fallback label for an unlabeled Arabic CodeGroup tab', async () => {
    const html = await render('<CodeGroup>\n\n```\necho ready\n```\n\n</CodeGroup>', 'ar');
    expect(html).toContain('علامة التبويب 1');
  });
});
