// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSlashItems } from './extensions/slash-command';
import { buildEditorExtensions } from './tiptap-editor';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  vi.restoreAllMocks();
});

const runImageCommand = (onUpload?: (file: File) => Promise<string | null>) => {
  const extensions = buildEditorExtensions(onUpload ? { onUpload } : {});
  const editor = new Editor({ element: document.createElement('div'), extensions });
  editors.push(editor);
  // The slash menu builds its items from the options the editor configured.
  const slash = editor.extensionManager.extensions.find((extension) => extension.name === 'slashCommand');
  const item = createSlashItems(slash?.options.onUpload).find((candidate) => candidate.titleKey === 'editor.slash.image.title');
  item?.command({ editor, range: { from: 1, to: 1 }, locale: 'en' });
  return editor;
};

describe('image slash command', () => {
  it('asks for an image URL when no uploader is configured', () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('https://example.com/a.png');
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    const editor = runImageCommand();
    expect(prompt).toHaveBeenCalledOnce();
    expect(click).not.toHaveBeenCalled();
    expect(JSON.stringify(editor.getJSON())).toContain('https://example.com/a.png');
  });

  it('opens the file picker when an uploader is configured', () => {
    const prompt = vi.spyOn(window, 'prompt');
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    runImageCommand(async () => 'https://example.com/b.png');
    expect(click).toHaveBeenCalledOnce();
    expect(prompt).not.toHaveBeenCalled();
    for (const input of document.querySelectorAll('input[type="file"]')) input.remove();
  });
});
