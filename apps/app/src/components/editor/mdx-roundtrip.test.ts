// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import mixedFixture from './__fixtures__/mixed-components.mdx?raw';
import supportedFixture from './__fixtures__/supported-components.mdx?raw';
import { findQuoteRange } from './extensions/comment-decorations';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

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

describe('fixture-driven MDX round trips', () => {
  it('keeps rendered built-ins structured while preserving extra props and expressions', () => {
    const editor = createEditor(supportedFixture);
    const json = editor.getJSON();
    const serialized = JSON.stringify(json);

    expect(serialized).toContain('mdxCardGroup');
    expect(serialized).toContain('mdxCard');
    expect(serialized).toContain('mdxTabs');
    expect(serialized).toContain('mdxAccordion');
    expect(serialized).toContain('mdxSteps');
    expect(serialized).toContain('mdxFrame');
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
  });

  it('updates an editable prop without dropping untouched custom props', () => {
    const editor = createEditor(supportedFixture);
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
    const editor = createEditor(mixedFixture);
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
    const once = getMarkdown(createEditor(mixedFixture));
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
    const first = createEditor(mixedFixture);
    const before = findQuoteRange(first.state.doc, 'Editable text after the custom block');
    const second = createEditor(getMarkdown(first));
    const after = findQuoteRange(second.state.doc, 'Editable text after the custom block');
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
  });
});
