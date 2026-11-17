import { describe, expect, it } from 'vitest';
import { isLeftToRightLabel, leftToRightIslands, splitLastWord } from './answer-inline';

const islands = (text: string) => leftToRightIslands(text).map(({ text: part, leftToRight }) => (leftToRight ? `[${part}]` : part));

describe('left-to-right islands in an answer', () => {
  it('isolates links, paths, emails and dotted names, leaving the sentence’s punctuation outside', () => {
    expect(islands('زر https://docs.example.com/setup، ثم ارجع.')).toEqual(['زر ', '[https://docs.example.com/setup]', '، ثم ارجع.']);
    expect(islands('Edit /etc/nibleaf.conf or config.json.')).toEqual(['Edit ', '[/etc/nibleaf.conf]', ' or ', '[config.json]', '.']);
    expect(islands('راسلنا على (help@example.com).')).toEqual(['راسلنا على (', '[help@example.com]', ').']);
  });

  it('keeps the brackets a link opened inside its island, and only the sentence’s outside', () => {
    const link = 'https://en.wikipedia.org/wiki/Function_(mathematics)';
    expect(islands(`راجع ${link}.`)).toEqual(['راجع ', `[${link}]`, '.']);
    expect(islands(`(${link})، ثم`)).toEqual(['(', `[${link}]`, ')، ثم']);
    expect(islands('See [docs.example.com/a_[b]].')).toEqual(['See [', '[docs.example.com/a_[b]]', '].']);
    expect(islands('(config.json).')).toEqual(['(', '[config.json]', ').']);
  });

  it('leaves plain words, numbers and Arabic words as they are', () => {
    expect(islands('قد يستغرق ذلك 24 ساعة.')).toEqual(['قد يستغرق ذلك 24 ساعة.']);
    expect(islands('Open the settings page.')).toEqual(['Open the settings page.']);
    expect(islands('')).toEqual([]);
  });

  it('reads a label as left to right only when it has Latin letters and no right-to-left ones', () => {
    expect(isLeftToRightLabel('Settings → Custom domain')).toBe(true);
    expect(isLeftToRightLabel('نشر')).toBe(false);
    expect(isLeftToRightLabel('زر Publish')).toBe(false);
    expect(isLeftToRightLabel('24')).toBe(false);
  });
});

describe('the word a citation stays with', () => {
  it('takes the last word and its punctuation, and drops the space before the citation', () => {
    expect(splitLastWord('Add the domain. ')).toEqual({ head: 'Add the ', word: 'domain.' });
    expect(splitLastWord('خلال 24 ساعة.')).toEqual({ head: 'خلال 24 ', word: 'ساعة.' });
    expect(splitLastWord('  ')).toEqual({ head: '', word: '' });
  });

  it('keeps a long word (a long link) with its citation too; the layout lets it wrap inside', () => {
    const link = `https://docs.example.com/${'a'.repeat(60)}`;
    expect(splitLastWord(`See ${link} `)).toEqual({ head: 'See ', word: link });
  });
});
