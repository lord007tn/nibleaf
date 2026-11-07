// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
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

const find = (editor: Editor, type: string, index = 0): { node: PMNode; pos: number } => {
  const found: Array<{ node: PMNode; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === type) found.push({ node, pos });
  });
  const match = found[index];
  if (!match) throw new Error(`no ${type} #${index}`);
  return match;
};

const setAttrs = (editor: Editor, type: string, attrs: Record<string, unknown>, index = 0) => {
  const { node, pos } = find(editor, type, index);
  editor.commands.command(({ tr }) => {
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
    return true;
  });
};

/** Mintlify-style source using every literal JSX form the editor reads. */
const mintlifySource = [
  '<Columns cols={3}>',
  '<Column>',
  'One',
  '</Column>',
  '</Columns>',
  '<Accordion title="Setup" defaultOpen={true} icon="rocket" id="setup">',
  'Body',
  '</Accordion>',
  '<Card title="Guide" href="/guide" horizontal arrow={true} cta="Read the guide">',
  'Text',
  '</Card>',
  '<Steps titleSize="h3">',
  '<Step title="First" stepNumber={2}>',
  'Do it.',
  '</Step>',
  '</Steps>',
  '<Tabs sync={false} defaultTabIndex={1} borderBottom>',
  '<Tab title="npm" icon="package">',
  'npm i',
  '</Tab>',
  '<Tab title="pnpm" id="pnpm-install">',
  'pnpm add',
  '</Tab>',
  '</Tabs>',
  '<Update label="v2" tags={["Feature", "Fix"]} description="Search">',
  'Faster.',
  '</Update>',
  '<ParamField query="limit" type="number" required={false} pre={["GET"]} post={[\'beta\']} placeholder="10">',
  'Page size.',
  '</ParamField>',
  'Text with <Badge color="blue" size="sm" shape="pill" stroke>New</Badge> and <Tooltip tip="More" headline="API" cta="Docs" href="/api">term</Tooltip>.',
].join('\n\n');

describe('Mintlify component props in the editor', () => {
  it('reads literal JSX expressions into typed node attributes', () => {
    const editor = createEditor(mintlifySource);
    expect(find(editor, 'mdxColumns').node.attrs.cols).toBe('3');
    expect(find(editor, 'mdxAccordion').node.attrs).toMatchObject({ defaultOpen: true, icon: 'rocket', id: 'setup' });
    expect(find(editor, 'mdxCard').node.attrs).toMatchObject({ horizontal: true, arrow: true, cta: 'Read the guide' });
    expect(find(editor, 'mdxSteps').node.attrs.titleSize).toBe('h3');
    expect(find(editor, 'mdxStep').node.attrs.stepNumber).toBe('2');
    expect(find(editor, 'mdxTabs').node.attrs).toMatchObject({ sync: false, defaultTabIndex: '1', borderBottom: true });
    expect(find(editor, 'mdxTab', 1).node.attrs.id).toBe('pnpm-install');
    expect(find(editor, 'mdxUpdate').node.attrs.tags).toEqual(['Feature', 'Fix']);
    expect(find(editor, 'mdxParamField').node.attrs).toMatchObject({ required: false, pre: ['GET'], post: ['beta'], placeholder: '10' });
    expect(find(editor, 'mdxBadge').node.attrs).toMatchObject({ color: 'blue', size: 'sm', shape: 'pill', stroke: true });
    expect(find(editor, 'mdxTooltip').node.attrs).toMatchObject({ tip: 'More', headline: 'API', cta: 'Docs', href: '/api' });
  });

  it('writes every authored form back exactly when nothing changed', () => {
    const editor = createEditor(mintlifySource);
    const output = getMarkdown(editor);
    for (const opening of [
      '<Columns cols={3}>',
      '<Accordion title="Setup" defaultOpen={true} icon="rocket" id="setup">',
      '<Card title="Guide" href="/guide" horizontal arrow={true} cta="Read the guide">',
      '<Step title="First" stepNumber={2}>',
      '<Tabs sync={false} defaultTabIndex={1} borderBottom>',
      '<Update label="v2" tags={["Feature", "Fix"]} description="Search">',
      `<ParamField query="limit" type="number" required={false} pre={["GET"]} post={['beta']} placeholder="10">`,
      '<Badge color="blue" size="sm" shape="pill" stroke>New</Badge>',
      '<Tooltip tip="More" headline="API" cta="Docs" href="/api">term</Tooltip>',
    ]) {
      expect(output).toContain(opening);
    }
    expect(getMarkdown(createEditor(output))).toBe(output);
  });

  it('writes an edited prop in its canonical form and keeps the rest as authored', () => {
    const editor = createEditor(mintlifySource);
    setAttrs(editor, 'mdxColumns', { cols: '4' });
    setAttrs(editor, 'mdxAccordion', { defaultOpen: false });
    setAttrs(editor, 'mdxCard', { arrow: false, horizontal: false });
    setAttrs(editor, 'mdxStep', { stepNumber: '5' });
    setAttrs(editor, 'mdxTabs', { sync: true, defaultTabIndex: '0' });
    setAttrs(editor, 'mdxUpdate', { tags: ['Feature', 'Fix', 'Docs'] });
    setAttrs(editor, 'mdxParamField', { required: true, pre: [] });
    setAttrs(editor, 'mdxBadge', { size: 'md', stroke: false });
    const output = getMarkdown(editor);
    expect(output).toContain('<Columns cols={4}>');
    expect(output).toContain('<Accordion title="Setup" icon="rocket" id="setup">');
    expect(output).toContain('<Card title="Guide" href="/guide" cta="Read the guide">');
    expect(output).toContain('<Step title="First" stepNumber={5}>');
    // Back to the defaults (sync on, first tab): both props disappear.
    expect(output).toContain('<Tabs borderBottom>');
    expect(output).toContain('<Update label="v2" tags={["Feature", "Fix", "Docs"]} description="Search">');
    expect(output).toContain(`<ParamField query="limit" type="number" required post={['beta']} placeholder="10">`);
    expect(output).toContain('<Badge color="blue" shape="pill">New</Badge>');
    expect(output).not.toMatch(/[=]"\s*"/);
  });

  it('turns quoted numbers into canonical expressions only when they change', () => {
    const editor = createEditor('<CardGroup cols="3">\n\n<Card title="A">\n\nA\n\n</Card>\n\n</CardGroup>');
    expect(getMarkdown(editor)).toContain('<CardGroup cols="3">');
    setAttrs(editor, 'mdxCardGroup', { cols: '4' });
    expect(getMarkdown(editor)).toContain('<CardGroup cols={4}>');
  });

  it('removes an attribute when its value is emptied (never writes attr="")', () => {
    const editor = createEditor('<Card title="A" icon="star" href="/a" img="/a.png">\n\nBody\n\n</Card>');
    setAttrs(editor, 'mdxCard', { icon: '', img: '' });
    expect(getMarkdown(editor)).toContain('<Card title="A" href="/a">');
  });

  it('keeps code expressions it cannot read untouched', () => {
    const source = '<Tabs sync={settings.sync} defaultTabIndex={initialTab}>\n\n<Tab title="A">\n\nA\n\n</Tab>\n\n</Tabs>';
    const editor = createEditor(source);
    expect(find(editor, 'mdxTabs').node.attrs.defaultTabIndex).toBe('{initialTab}');
    setAttrs(editor, 'mdxTabs', { borderBottom: true });
    expect(getMarkdown(editor)).toContain('<Tabs sync={settings.sync} defaultTabIndex={initialTab} borderBottom>');
  });

  it.each<[string, JSONContent, string]>([
    [
      'Card',
      { type: 'mdxCard', attrs: { title: 'A', horizontal: true, img: '/a.png', cta: 'Go', arrow: true, color: '#ff0000' } },
      '<Card title="A" horizontal img="/a.png" cta="Go" arrow color="#ff0000">',
    ],
    [
      'Columns',
      { type: 'mdxColumns', attrs: { cols: '2' }, content: [{ type: 'mdxColumn', content: [{ type: 'paragraph' }] }] },
      '<Columns cols={2}>',
    ],
    [
      'Tabs',
      {
        type: 'mdxTabs',
        attrs: { defaultTabIndex: '1', sync: false, borderBottom: true },
        content: [{ type: 'mdxTab', attrs: { title: 'T', icon: 'code', id: 'install' } }],
      },
      '<Tabs defaultTabIndex={1} sync={false} borderBottom>',
    ],
    [
      'Tab',
      { type: 'mdxTabs', content: [{ type: 'mdxTab', attrs: { title: 'T', icon: 'code', id: 'install' } }] },
      '<Tab title="T" icon="code" id="install">',
    ],
    [
      'Accordion',
      { type: 'mdxAccordion', attrs: { title: 'Q', description: 'More', icon: 'help', id: 'faq', defaultOpen: true } },
      '<Accordion title="Q" defaultOpen description="More" icon="help" id="faq">',
    ],
    [
      'Steps',
      {
        type: 'mdxSteps',
        attrs: { titleSize: 'h2' },
        content: [{ type: 'mdxStep', attrs: { title: 'S', icon: 'check', stepNumber: '3', titleSize: 'h3' } }],
      },
      '<Steps titleSize="h2">',
    ],
    [
      'Step',
      { type: 'mdxSteps', content: [{ type: 'mdxStep', attrs: { title: 'S', icon: 'check', stepNumber: '3', titleSize: 'h3' } }] },
      '<Step title="S" icon="check" stepNumber={3} titleSize="h3">',
    ],
    ['Frame', { type: 'mdxFrame', attrs: { caption: 'C', hint: 'Look here' } }, '<Frame caption="C" hint="Look here">'],
    [
      'ParamField',
      { type: 'mdxParamField', attrs: { body: 'name', type: 'string', required: true, placeholder: 'Ada', pre: ['POST'], post: ['v2'] } },
      '<ParamField body="name" type="string" required placeholder="Ada" pre={["POST"]} post={["v2"]}>',
    ],
    [
      'ResponseField',
      { type: 'mdxResponseField', attrs: { name: 'id', type: 'string', pre: ['read-only'] } },
      '<ResponseField name="id" type="string" pre={["read-only"]}>',
    ],
    ['Update', { type: 'mdxUpdate', attrs: { label: 'v1', tags: ['Fix'] } }, '<Update label="v1" tags={["Fix"]}>'],
  ])('writes a new %s with its props', (_name, json, opening) => {
    const editor = createEditor('');
    const withBody = (node: JSONContent): JSONContent =>
      node.content || ['mdxColumns'].includes(node.type ?? '')
        ? { ...node, content: node.content?.map(withBody) }
        : { ...node, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] };
    editor.commands.setContent(withBody(json));
    const output = getMarkdown(editor);
    expect(output).toContain(opening);
    expect(getMarkdown(createEditor(output))).toBe(output);
  });

  it('writes new inline Badge and Tooltip props', () => {
    const editor = createEditor('');
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mdxBadge',
              attrs: { color: 'green', size: 'lg', shape: 'pill', icon: 'check', stroke: true, disabled: true },
              content: [{ type: 'text', text: 'Live' }],
            },
            { type: 'text', text: ' ' },
            { type: 'mdxTooltip', attrs: { tip: 'Tip', headline: 'Head', cta: 'More', href: '/more' }, content: [{ type: 'text', text: 'word' }] },
          ],
        },
      ],
    });
    const output = getMarkdown(editor);
    expect(output).toContain('<Badge color="green" size="lg" shape="pill" icon="check" stroke disabled>Live</Badge>');
    expect(output).toContain('<Tooltip tip="Tip" headline="Head" cta="More" href="/more">word</Tooltip>');
  });

  describe('callout icon and color', () => {
    it('keeps an authored custom callout and edits its look', () => {
      const editor = createEditor('<Callout type="tip" icon="rocket" color="#FFC107">\n\nGo.\n\n</Callout>');
      expect(find(editor, 'callout').node.attrs).toMatchObject({ variant: 'tip', icon: 'rocket', color: '#FFC107' });
      expect(getMarkdown(editor)).toContain('<Callout type="tip" icon="rocket" color="#FFC107">');
      setAttrs(editor, 'callout', { color: '' });
      expect(getMarkdown(editor)).toContain('<Callout type="tip" icon="rocket">');
    });

    it('turns a typed callout into <Callout> when it gets a custom look', () => {
      const editor = createEditor('<Warning>\n\nCareful.\n\n</Warning>');
      setAttrs(editor, 'callout', { icon: 'shield' });
      const output = getMarkdown(editor);
      expect(output).toContain('<Callout type="warning" icon="shield">');
      expect(output).toContain('</Callout>');
      expect(output).not.toContain('Warning>');
    });

    it('writes an admonition callout as <Callout> only once it has a custom look', () => {
      const editor = createEditor('> [!NOTE]\n> Plain.');
      expect(getMarkdown(editor)).toContain('> [!NOTE]');
      setAttrs(editor, 'callout', { color: '#2563eb' });
      expect(getMarkdown(editor)).toContain('<Callout type="note" color="#2563eb">');
    });
  });
});
