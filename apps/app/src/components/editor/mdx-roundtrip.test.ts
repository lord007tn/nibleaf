// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { findQuoteRange } from './extensions/comment-decorations';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const mixedSample = `# Mixed content

import Chart from './Chart'

export const chartTheme = { axis: 'red' }

Editable text before the custom block.

<Chart data={points} options={{ axis: { color: "red" } }}>
  <Chart.Legend position="bottom" />
  {points.map((point) => <Chart.Point key={point.id} {...point} />)}
</Chart>

Editable text after the custom block with an inline <Status value={build.status} /> component and {user.name} expression.

{condition ? <Feature flag={flag} /> : fallback}

<Tabs>

<Tab title="Supported">

<CustomWidget config={{ dense: true }} />

This supported child remains structured.

</Tab>

</Tabs>`;

const supportedSample = `<Callout type="warning" data-track="hero">

Keep the **original props**.

</Callout>

<CardGroup cols="3" className={gridClass}>

<Card title="API" icon={icons.api} href="/api" data-analytics={{ area: 'docs' }}>

Read the API guide.

</Card>

</CardGroup>

<Tabs>

<Tab title="TypeScript">

\`\`\`ts title="client.ts"
const answer = 42;
\`\`\`

</Tab></Tabs>

<AccordionGroup>

<Accordion title="Details" defaultOpen={flags.expanded}>

Nested **Markdown** stays editable.

</Accordion>

</AccordionGroup>

<Steps>

<Step title="Install">Run the installer.</Step>

</Steps>

<Frame caption="Architecture" data-lightbox>

![Architecture diagram](/images/architecture.png)

</Frame>

<FileTree>

<Folder name="src" defaultOpen>

<File name="index.ts" icon="file-code" />

</Folder>

</FileTree>

<ApiExample title="Create a page">

<RequestExample title="Request">

\`POST /pages\`

</RequestExample>

<ResponseExample title="Response" status="201">

\`{ "id": "page_1" }\`

</ResponseExample>

</ApiExample>

<RelatedContent title="Next">

<RelatedCard title="Authentication" description="Secure your requests" href="/auth" icon="key">

Read the authentication guide.

</RelatedCard>

</RelatedContent>

Inline <Tooltip tip="More info" data-id="tip-1">help</Tooltip>, <Badge color="green">stable</Badge>, and <Icon icon={currentIcon} size="16" />.`;

const editors: Editor[] = [];

const createEditor = (markdown: string) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor;
};

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

describe('MDX round trips', () => {
  it('reads character references in attributes once, so editing never escapes them again', () => {
    const source = 'Intro.\n\n<Card title="R&amp;D &quot;labs&quot;" href="/x?a=1&amp;b=2">\n\nBody\n\n</Card>\n';
    const editor = createEditor(source);
    let card: { attrs: Record<string, unknown> } | undefined;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'mdxCard') card = node;
    });
    expect(card?.attrs.title).toBe('R&D "labs"');
    expect(card?.attrs.href).toBe('/x?a=1&b=2');
    // Untouched, the authored tag is saved byte for byte.
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('!');
    expect(getMarkdown(editor)).toContain('<Card title="R&amp;D &quot;labs&quot;" href="/x?a=1&amp;b=2">');
    // Edited, the title is escaped exactly once, and reloads the same.
    let position = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === 'mdxCard') position = at;
    });
    editor.commands.command(({ tr }) => {
      tr.setNodeAttribute(position, 'title', 'R&D!');
      return true;
    });
    const saved = getMarkdown(editor);
    expect(saved).toContain('title="R&amp;D!"');
    expect(saved).not.toContain('&amp;amp;');
    expect(getMarkdown(createEditor(saved))).toBe(saved);
  });

  it.each([
    '> [!WARNING]\n> Do **not** run [this](/x) with `rm -rf`.',
    '> [!NOTE] Do **not** run [this](/x).',
    '> [!TIP]\n> First *line*.\n>\n> Second **line**.',
  ])('keeps the formatting in a callout written as a GitHub alert through load and save: %j', (source) => {
    const saved = getMarkdown(createEditor(source));
    expect(saved).toContain('**');
    expect(saved).not.toContain('[!WARNING]\n> Do not');
    const callout = createEditor(saved).state.doc.firstChild;
    expect(callout?.type.name).toBe('callout');
    // Bold, links and code survive a second load, and the marker isn't left in the text.
    expect(getMarkdown(createEditor(saved))).toBe(saved);
    expect(callout?.textContent).not.toMatch(/\[!/);
    if (source.includes('[this](/x)')) expect(saved).toContain('[this](/x)');
    if (source.includes('`rm -rf`')) expect(saved).toContain('`rm -rf`');
  });

  it('saves a GitHub alert that starts with an image unchanged', () => {
    const source = '> [!NOTE]\n> ![Diagram](/a.png)';
    const saved = getMarkdown(createEditor(source));
    expect(saved).toBe(source);
    expect(getMarkdown(createEditor(saved))).toBe(saved);
  });

  it.each(['TRUE', ' true ', 'False', '{open}'])('keeps an authored defaultOpen="%s" as written when another block is edited', (value) => {
    const source = `Intro.\n\n<Accordion title="FAQ" defaultOpen="${value}">\n\nBody\n\n</Accordion>\n`;
    const editor = createEditor(source);
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('!');
    expect(getMarkdown(editor)).toContain(`<Accordion title="FAQ" defaultOpen="${value}">`);
  });

  it('decodes every named character reference in an attribute once, and leaves bare ampersands alone', () => {
    const source = 'Intro.\n\n<Card title="A &mdash; B&nbsp;C &copy; &unknownref;" href="/x?a=1&copy=2">\n\nBody\n\n</Card>\n';
    const editor = createEditor(source);
    let card: { attrs: Record<string, unknown> } | undefined;
    let position = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === 'mdxCard') {
        card = node;
        position = at;
      }
    });
    expect(card?.attrs.title).toBe('A — B C © &unknownref;');
    // A reference without its `;` (a URL query) isn't a reference.
    expect(card?.attrs.href).toBe('/x?a=1&copy=2');
    editor.commands.command(({ tr }) => {
      tr.setNodeAttribute(position, 'title', 'A — B > C!');
      return true;
    });
    const saved = getMarkdown(editor);
    // Written back escaped once, `>` included, and reloads the same.
    expect(saved).toContain('title="A — B &gt; C!"');
    expect(saved).not.toContain('&amp;mdash;');
    expect(getMarkdown(createEditor(saved))).toBe(saved);
  });

  it('decodes references case-sensitively, keeps partial names, and reads invalid code points as U+FFFD', () => {
    const source = 'Intro.\n\n<Card title="&Lt; &notit; &#xD800; &#0; &AMP; &toString; &constructor;" href="/x">\n\nBody\n\n</Card>\n';
    const editor = createEditor(source);
    let card: { attrs: Record<string, unknown> } | undefined;
    let position = -1;
    editor.state.doc.descendants((node, at) => {
      if (node.type.name === 'mdxCard') {
        card = node;
        position = at;
      }
    });
    // `&Lt;` is "≪", not "<"; `&notit;` isn't a reference (not "¬it;"), and
    // neither is a name that only exists on Object.prototype.
    expect(card?.attrs.title).toBe('≪ &notit; � � & &toString; &constructor;');
    editor.commands.command(({ tr }) => {
      tr.setNodeAttribute(position, 'title', `${String(card?.attrs.title)}!`);
      return true;
    });
    const saved = getMarkdown(editor);
    expect(saved).toContain('title="≪ &amp;notit; � � &amp; &amp;toString; &amp;constructor;!"');
    // No lone surrogate reaches the saved source, so it reloads the same.
    expect(getMarkdown(createEditor(saved))).toBe(saved);
  });

  it.each(['> [!NOTE]\n> ![alt](/img.png)\n> **second**', '> [!NOTE]\n> first\n>\n> **second**'])(
    'keeps a GitHub alert paragraph that starts with bold after another block, across two saves: %j',
    (source) => {
      const saved = getMarkdown(createEditor(source));
      if (source.includes('![alt]')) expect(saved).toContain('![alt](/img.png)');
      expect(saved).toContain('**second**');
      expect(saved).not.toContain('****');
      expect(createEditor(saved).state.doc.firstChild?.type.name).toBe('callout');
      expect(getMarkdown(createEditor(saved))).toBe(saved);
    },
  );

  it.each([
    ['> first\n>\n> **second**', '**second**'],
    ['> first\n>\n> *second*', '*second*'],
    ['> ![alt](/img.png)\n>\n> **second**', '**second**'],
    ['> first\n>\n> - item\n>\n> **after a list**', '**after a list**'],
  ])('keeps a plain quote paragraph that starts with bold or italic after another block, across two saves (#338): %j', (source, mark) => {
    const saved = getMarkdown(createEditor(source));
    expect(saved).toContain(`> ${mark}`);
    expect(saved).not.toMatch(/\*\*\*\*|\*> |\\\*/);
    expect(createEditor(saved).state.doc.firstChild?.type.name).toBe('blockquote');
    expect(getMarkdown(createEditor(saved))).toBe(saved);
  });

  it.each(['> Before\n>\n> ```js\n> const a = 1;\n> ```', '> [!NOTE]\n> Before\n>\n> ```js\n> const a = 1;\n> ```'])(
    'saves a fenced code block inside a quote with one quote prefix per line (#338): %j',
    (source) => {
      const saved = getMarkdown(createEditor(source));
      expect(saved).not.toContain('> >');
      expect(saved).toContain('> ```js\n> const a = 1;\n> ```');
      expect(getMarkdown(createEditor(saved))).toBe(saved);
    },
  );

  it('keeps components after an unmatched backtick, across a heading', () => {
    // A backtick that isn't closed on its line must not hide the blocks after it.
    const source = 'Before `unmatched\n\n# Heading\n\n<CustomWidget value="keep" />\n\nend`\n';
    const output = getMarkdown(createEditor(source));
    expect(output).toContain('<CustomWidget value="keep" />');
    expect(output).not.toContain('data-mdx-source');
  });

  it('keeps a self-closing RelatedCard self-closing, and pairs it once it gains a body', () => {
    const source =
      'Intro.\n\n<RelatedContent title="More">\n\n<RelatedCard title="Auth" description="Sign requests" href="/auth" />\n\n</RelatedContent>\n';
    const editor = createEditor(source);
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('!');
    const saved = getMarkdown(editor);
    expect(saved).toContain('<RelatedCard title="Auth" description="Sign requests" href="/auth" />');
    expect(saved).not.toContain('</RelatedCard>');
    // Saving again changes nothing.
    expect(getMarkdown(createEditor(saved))).toBe(saved);
    // A body typed into the card turns it into a pair, so the text is kept.
    const card = createEditor(source);
    let cardBody = -1;
    card.state.doc.descendants((node, position) => {
      if (node.type.name === 'mdxRelatedCard') cardBody = position + 2;
    });
    card.commands.setTextSelection(cardBody);
    card.commands.insertContent('Body text');
    const paired = getMarkdown(card);
    expect(paired).toMatch(/<RelatedCard title="Auth" description="Sign requests" href="\/auth">\s+Body text\s+<\/RelatedCard>/);
  });

  it.each([
    '```python\nimport requests\nexport_token = "demo"\n```',
    '~~~sh\nexport API_URL=http://localhost:4311\n~~~',
    '<CodeGroup>\n\n```python\nimport requests\n```\n\n</CodeGroup>',
  ])('preserves import/export statements inside documentation code examples', (source) => {
    const editor = createEditor(source);
    const output = getMarkdown(editor);
    expect(output).not.toContain('nibleaf-mdx-opaque');
    expect(output).toContain(source.includes('import requests') ? 'import requests' : 'export API_URL=http://localhost:4311');
    expect(JSON.stringify(editor.getJSON())).not.toContain('MDX module');
  });

  it('keeps rendered built-ins structured while preserving extra props and expressions', () => {
    const editor = createEditor(supportedSample);
    const json = editor.getJSON();
    const serialized = JSON.stringify(json);

    expect(serialized).toContain('mdxCardGroup');
    expect(serialized).toContain('mdxCard');
    expect(serialized).toContain('mdxTabs');
    expect(serialized).toContain('mdxAccordion');
    expect(serialized).toContain('mdxSteps');
    expect(serialized).toContain('mdxFrame');
    expect(serialized).toContain('mdxFileTree');
    expect(serialized).toContain('mdxFolder');
    expect(serialized).toContain('mdxFile');
    expect(serialized).toContain('mdxApiExample');
    expect(serialized).toContain('mdxRequestExample');
    expect(serialized).toContain('mdxResponseExample');
    expect(serialized).toContain('mdxRelatedContent');
    expect(serialized).toContain('mdxRelatedCard');
    expect(serialized).toContain('image');
    expect(serialized).toContain('mdxTooltip');
    expect(serialized).toContain('mdxIcon');

    const output = getMarkdown(editor);
    expect(output).toContain('<CardGroup cols="3" className={gridClass}>');
    expect(output).toContain('<Card title="API" icon={icons.api} href="/api" data-analytics={{ area: \'docs\' }}>');
    expect(output).toContain('<Accordion title="Details" defaultOpen={flags.expanded}>');
    expect(output).toContain('<Icon icon={currentIcon} size="16" />');
    expect(output).toContain('```ts title="client.ts"');
    expect(output).toContain('<Frame caption="Architecture" data-lightbox>');
    expect(output).toContain('![Architecture diagram](/images/architecture.png)');
    expect(output).toContain('Nested **Markdown** stays editable.');
    expect(output).toContain('<Folder name="src" defaultOpen>');
    expect(output).toContain('<File name="index.ts" icon="file-code" />');
    expect(output).toContain('<ResponseExample title="Response" status="201">');
    expect(output).toContain('<RelatedCard title="Authentication" description="Secure your requests" href="/auth" icon="key">');
  });

  it('updates an editable prop without dropping untouched custom props', () => {
    const editor = createEditor(supportedSample);
    let cardPosition = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'mdxCard') cardPosition = pos;
    });
    expect(cardPosition).toBeGreaterThanOrEqual(0);
    editor.commands.command(({ tr }) => {
      tr.setNodeMarkup(cardPosition, undefined, { ...tr.doc.nodeAt(cardPosition)?.attrs, title: 'Updated API' });
      return true;
    });

    const output = getMarkdown(editor);
    expect(output).toContain('<Card title="Updated API" icon={icons.api} href="/api" data-analytics={{ area: \'docs\' }}>');
  });

  it('preserves unknown block, inline JSX, and expressions while supported siblings stay editable', () => {
    const editor = createEditor(mixedSample);
    const opaqueSources: string[] = [];
    const nodeTypes: string[] = [];
    editor.state.doc.descendants((node) => {
      nodeTypes.push(node.type.name);
      if (node.type.name === 'mdxOpaqueBlock' || node.type.name === 'mdxOpaqueInline') opaqueSources.push(String(node.attrs.source));
    });

    expect(nodeTypes).toContain('mdxOpaqueBlock');
    expect(nodeTypes).toContain('mdxOpaqueInline');
    expect(nodeTypes).toContain('mdxTabs');
    expect(opaqueSources).toContain(`<Chart data={points} options={{ axis: { color: "red" } }}>
  <Chart.Legend position="bottom" />
  {points.map((point) => <Chart.Point key={point.id} {...point} />)}
</Chart>`);
    expect(opaqueSources).toContain('<Status value={build.status} />');
    expect(opaqueSources).toContain('{user.name}');
    expect(opaqueSources).toContain('{condition ? <Feature flag={flag} /> : fallback}');
    expect(opaqueSources).toContain('<CustomWidget config={{ dense: true }} />');
    expect(opaqueSources).toContain("import Chart from './Chart'");
    expect(opaqueSources).toContain("export const chartTheme = { axis: 'red' }");

    editor.commands.insertContentAt(1, 'Updated ');
    const output = getMarkdown(editor);
    for (const source of opaqueSources) expect(output).toContain(source);
    expect(output).toContain('# Updated Mixed content');
    expect(output).toContain('<Tabs>');
  });

  it('reaches a stable serialization fixed point without losing opaque source', () => {
    const once = getMarkdown(createEditor(mixedSample));
    const twice = getMarkdown(createEditor(once));
    expect(twice).toBe(once);
    expect(twice).toContain('<Chart data={points} options={{ axis: { color: "red" } }}>');
  });

  it('preserves an unclosed custom tag without swallowing editable content after it', () => {
    const source = '<Broken prop={value}>\n\nEditable after the malformed tag.';
    const editor = createEditor(source);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['mdxOpaqueBlock', 'paragraph']);
    expect(getMarkdown(editor)).toContain(source);
  });
});

describe('comment anchors around opaque MDX', () => {
  it('anchors supported text on either side and never joins a quote across an opaque node', () => {
    const editor = createEditor('alpha <Status value={state} /> omega');
    expect(findQuoteRange(editor.state.doc, 'alpha')).not.toBeNull();
    expect(findQuoteRange(editor.state.doc, 'omega')).not.toBeNull();
    expect(findQuoteRange(editor.state.doc, 'alpha omega')).toBeNull();
  });

  it('keeps the same quote resolvable after an opaque block round trip', () => {
    const first = createEditor(mixedSample);
    const before = findQuoteRange(first.state.doc, 'Editable text after the custom block');
    const second = createEditor(getMarkdown(first));
    const after = findQuoteRange(second.state.doc, 'Editable text after the custom block');
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
  });
});
