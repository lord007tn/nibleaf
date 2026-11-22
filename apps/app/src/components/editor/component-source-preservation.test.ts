// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const languages = [
  ['EN', 'Body', 'Architecture', 'Next'],
  ['AR', 'النص', 'البنية', 'التالي'],
] as const;

describe.each(languages)('first-save component source preservation (#625), %s', (_language, body, caption, next) => {
  it.each([
    ['indented text inside a Note', `<Note>\n\n    ${body}\n\n</Note>`, ['callout', 'codeBlock']],
    ['a Frame with an HTML image', `<Frame caption="${caption}">\n  <img src="/diagram.png" alt="${caption}" />\n</Frame>`, ['mdxFrame', 'image']],
    ['adjacent parent and child tags', `<Steps>\n<Step title="${caption}">\n\n${body}\n\n</Step>\n</Steps>`, ['mdxSteps', 'mdxStep']],
    [
      'adjacent sibling tags',
      `<Steps>\n<Step title="${caption}">\n\n${body}\n\n</Step>\n<Step title="${next}">\n\n${body}\n\n</Step>\n</Steps>`,
      ['mdxSteps', 'mdxStep', 'mdxStep'],
    ],
  ] as const)('keeps %s byte for byte through ten saves', (_name, block, types) => {
    const source = `${body}\n\n${block}\n\n${next}`;
    let saved = source;
    for (let cycle = 0; cycle < 10; cycle++) {
      const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
      try {
        editor.commands.setContent(saved, { emitUpdate: false });
        const actualTypes: string[] = [];
        editor.state.doc.descendants((node) => {
          if (types.some((type) => type === node.type.name)) actualTypes.push(node.type.name);
        });
        expect(actualTypes).toEqual(types);
        saved = getMarkdown(editor);
        expect(saved, `cycle ${cycle + 1}`).toBe(source);
        editor.commands.setTextSelection(2);
        editor.commands.insertContent('!');
        expect(getMarkdown(editor)).toBe(`${body[0]}!${source.slice(1)}`);
      } finally {
        editor.destroy();
      }
    }
  });

  it('preserves the indented source after editing and undoing the code text', () => {
    const source = `<Note>\n\n    ${body}\n\n</Note>`;
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      editor.chain().setMeta('addToHistory', false).setContent(source, { emitUpdate: false }).run();
      editor.commands.setTextSelection(2);
      editor.commands.insertContent('!');
      expect(getMarkdown(editor)).toBe(`<Note>\n\n\`\`\`\n!${body}\n\`\`\`\n\n</Note>`);
      expect(editor.commands.undo()).toBe(true);
      expect(getMarkdown(editor)).toBe(source);
    } finally {
      editor.destroy();
    }
  });

  it.each([
    ['Tabs', '<Tabs>\n<Tab title="A">\n\n\t````md\nconst a = 1;\n\t````\n\n</Tab>\n</Tabs>'],
    ['CodeGroup', '<CodeGroup>\n\n\t~~~md\n<Card title="x" />\n\n\t~~~\n\n</CodeGroup>'],
  ])('keeps trailing prose outside %s when indented code looks like a fence', (tag, block) => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
    try {
      const trailing = `${next} <kbd>K</kbd>`;
      editor.commands.setContent(`${block}\n\n${trailing}`, { emitUpdate: false });
      const first = getMarkdown(editor);
      expect(first.endsWith(`</${tag}>\n\n${trailing}`)).toBe(true);
      for (let cycle = 2; cycle <= 3; cycle++) {
        editor.commands.setContent(first, { emitUpdate: false });
        expect(getMarkdown(editor), `save ${cycle}`).toBe(first);
      }
    } finally {
      editor.destroy();
    }
  });
});
