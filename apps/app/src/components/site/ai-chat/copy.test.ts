// @vitest-environment jsdom

import type { AiChatSource } from '@nibleaf/validators';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { htmlCopy, plainAnswer, plainCopy, writeCopy } from './copy';
import { answerSources } from './sources';

const source = (id: string, heading?: string, extra: Partial<AiChatSource> = {}): AiChatSource => ({
  id,
  pageId: 'domains',
  title: 'Connect a custom domain',
  path: 'custom-domains',
  ...(heading ? { heading, anchor: heading.toLowerCase().replaceAll(' ', '-') } : {}),
  snippet: '',
  direction: 'ltr',
  language: 'en',
  ...extra,
});
const labels = { sources: 'Sources', top: 'Top of page' };
const link = (cited: AiChatSource) => `https://docs.example.com/${cited.path}${cited.anchor ? `#${cited.anchor}` : ''}`;

describe('copying an answer', () => {
  it('turns model ids into the numbers on screen, without repeats or unknown ids', () => {
    const { numberOf } = answerSources([source('S3', 'Add your domain'), source('S1', 'Wait'), source('S4', 'Add your domain')]);
    expect(plainAnswer('Add it. [S3]\nWait. [S1, S4][S3]\nGone [S9].', numberOf)).toBe('Add it. [1]\nWait. [2][1]\nGone.');
  });

  it('drops bold and heading marks but keeps list numbers, inline code and fenced code as written', () => {
    const answer = [
      '## Steps',
      '',
      '1. Open **Settings → Custom domain** and enter `docs.**example**.com`. [S1]',
      '',
      '```sh',
      'echo "**not bold**" # [S1] stays inside code',
      '```',
      '',
      '### Done ###',
    ].join('\n');
    expect(plainAnswer(answer, () => 1)).toBe(
      [
        'Steps',
        '',
        '1. Open Settings → Custom domain and enter `docs.**example**.com`. [1]',
        '',
        '```sh',
        'echo "**not bold**" # [S1] stays inside code',
        '```',
        '',
        'Done',
      ].join('\n'),
    );
  });

  it('never changes code: inline (any backtick count), indented, or fenced inside a list', () => {
    const answer = [
      'Type `[S1]` or ``a**b`` literally, then *save*. [S1]',
      '',
      '    indented **code** [S1]',
      '',
      '1. Run this: [S2]',
      '',
      '   ```sh',
      '   echo "**x** [S1]"',
      '   ```',
      '',
      '2. **Check** it. [S2]',
      '',
      'Setext title',
      '============',
    ].join('\n');
    expect(plainAnswer(answer, (id) => (id === 'S1' ? 1 : 2))).toBe(
      [
        'Type `[S1]` or ``a**b`` literally, then save. [1]',
        '',
        '    indented **code** [S1]',
        '',
        '1. Run this: [2]',
        '',
        '   ```sh',
        '   echo "**x** [S1]"',
        '   ```',
        '',
        '2. Check it. [2]',
        '',
        'Setext title',
      ].join('\n'),
    );
  });

  it('ends with the numbered sources and their links', () => {
    const { sections, numberOf } = answerSources([source('S2', 'Add your domain'), source('S1')]);
    expect(plainCopy('Add it. [S2] More. [S1]', sections, numberOf, link, labels)).toBe(
      [
        'Add it. [1] More. [2]',
        '',
        'Sources',
        '[1] Connect a custom domain › Add your domain',
        'https://docs.example.com/custom-domains#add-your-domain',
        '[2] Connect a custom domain › Top of page',
        'https://docs.example.com/custom-domains',
      ].join('\n'),
    );
  });

  it('copies the rendered answer as HTML with numbered citations, sources and no attributes but dir', () => {
    const { sections } = answerSources([source('S1', 'Add your domain')]);
    const answer = document.createElement('div');
    answer.setAttribute('dir', 'auto');
    answer.className = 'prose';
    answer.innerHTML =
      '<p dir="auto" class="x">Open <strong>Settings</strong><button type="button" data-citation="1" class="chip" aria-label="Source 1">1</button></p><span title="t" data-x="1">s</span>';
    const html = htmlCopy(answer, sections, link, labels);
    expect(html).toBe(
      '<div dir="auto"><p dir="auto">Open <strong>Settings</strong> [1]</p><span>s</span><p><strong>Sources</strong></p><p>[1] <a href="https://docs.example.com/custom-domains#add-your-domain">Connect a custom domain › Add your domain</a></p></div>',
    );
  });
});

describe('citations in copied HTML', () => {
  it('keeps where a numbered list starts, and only a numeric start on an ordered list', () => {
    const answer = document.createElement('div');
    answer.innerHTML = '<ol start="3"><li>Third</li></ol><ol start="3x"><li>Bad</li></ol><ul start="2"><li>Bullet</li></ul>';
    const html = htmlCopy(answer, [], link, labels);
    expect(html).toBe('<div><ol start="3"><li>Third</li></ol><ol><li>Bad</li></ol><ul><li>Bullet</li></ul></div>');
  });

  it('puts one space before a run of citations, as in plain text', () => {
    const { sections } = answerSources([source('S1', 'Add your domain'), source('S2', 'Wait')]);
    const answer = document.createElement('div');
    answer.innerHTML =
      '<p>Add it. <button data-citation="1">1</button><button data-citation="2">2</button> Then wait<button data-citation="2">2</button></p>';
    expect(htmlCopy(answer, sections, link, labels)).toContain('<p>Add it. [1][2] Then wait [2]</p>');
  });
});

describe('writing to the clipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes plain text and HTML together where the browser can', async () => {
    const write = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal(
      'ClipboardItem',
      class {
        items: Record<string, Blob>;
        constructor(items: Record<string, Blob>) {
          this.items = items;
        }
      },
    );
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });
    await writeCopy('plain', '<p>html</p>');
    expect(write).toHaveBeenCalledOnce();
    const [[[item]]] = write.mock.calls as unknown as [[[{ items: Record<string, Blob> }]]];
    expect(Object.keys(item.items)).toEqual(['text/plain', 'text/html']);
    expect(await item.items['text/plain']?.text()).toBe('plain');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('falls back to plain text when a rich write is refused or unsupported', async () => {
    const write = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('navigator', { clipboard: { write, writeText } });
    await writeCopy('plain', '<p>html</p>');
    expect(writeText).toHaveBeenCalledWith('plain');
    vi.stubGlobal('ClipboardItem', undefined);
    await writeCopy('plain again', '<p>html</p>');
    expect(writeText).toHaveBeenLastCalledWith('plain again');
  });

  it('copies with the copy command where there is no async clipboard (plain http), and puts focus and selection back', async () => {
    vi.stubGlobal('navigator', {});
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const button = document.createElement('button');
    const text = document.createElement('p');
    text.textContent = 'Selected by the reader';
    dialog.append(text, button);
    document.body.append(dialog);
    button.focus();
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(text);
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe('Selected by the reader');
    const copied: Record<string, string> = {};
    const execCommand = vi.fn((command: string) => {
      // The hidden field is in the dialog (its focus trap keeps focus there) and selected.
      const field = dialog.querySelector('textarea');
      expect(document.activeElement).toBe(field);
      expect(field?.value).toBe('plain');
      const event = new Event('copy', { cancelable: true }) as ClipboardEvent;
      Object.defineProperty(event, 'clipboardData', {
        value: {
          setData: (type: string, value: string) => {
            copied[type] = value;
          },
        },
      });
      document.dispatchEvent(event);
      return command === 'copy';
    });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    await writeCopy('plain', '<p>html</p>');
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(copied).toEqual({ 'text/plain': 'plain', 'text/html': '<p>html</p>' });
    expect(dialog.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(document.getSelection()?.toString()).toBe('Selected by the reader');
    dialog.remove();
  });

  it('falls back to the copy command when writing text is refused, and rejects when nothing could copy', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('NotAllowedError');
    });
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    await writeCopy('plain');
    expect(execCommand).toHaveBeenCalledWith('copy');
    execCommand.mockReturnValue(false);
    await expect(writeCopy('plain')).rejects.toThrow();
    vi.stubGlobal('navigator', {});
    Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
    await expect(writeCopy('plain')).rejects.toThrow();
  });
});
