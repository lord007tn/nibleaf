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
});
