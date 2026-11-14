/**
 * Slash menu search and ranking (UX audit P1-ED-003): every query word must
 * start a word of the block's title, keywords or aliases, in any order; exact
 * and prefix title matches first, then the most-used blocks.
 */
import { type Locale, type MessageKey, translateFn } from '@nibleaf/i18n';
import { describe, expect, it } from 'vitest';
import { createSlashItems, nextSlashSelection, rankSlashItems, slashSection } from './extensions/slash-command';

const items = createSlashItems();
const titles = (query: string, locale: Locale = 'en') => rankSlashItems(items, query, locale).map((item) => item.titleKey);
const first = (query: string, locale: Locale = 'en') => titles(query, locale)[0];
const key = (name: string) => `editor.slash.${name}.title` as MessageKey;
const itemNamed = (name: string) => {
  const item = items.find((candidate) => candidate.titleKey === key(name));
  if (!item) throw new Error(`No slash item ${name}`);
  return item;
};

describe('multi-word slash queries', () => {
  // The ten queries from the audit that all returned an empty menu.
  it.each([
    ['code block', 'codeBlock'],
    ['code group', 'codeGroup'],
    ['card group', 'cardGroup'],
    ['2 columns', 'columns2'],
    ['param field', 'paramField'],
    ['api example', 'apiExample'],
    ['file tree', 'fileTree'],
    ['related content', 'relatedContent'],
    ['mermaid diagram', 'mermaid'],
    ['to-do list', 'todo'],
  ])('"/%s" finds %s first, with its words in either order', (query, name) => {
    expect(first(query)).toBe(key(name));
    expect(first(query.split(' ').reverse().join(' '))).toBe(key(name));
  });

  it('matches every word in any order, and drops blocks missing one of them', () => {
    expect(first('block code')).toBe(key('codeBlock'));
    expect(first('field param')).toBe(key('paramField'));
    expect(titles('code block')).not.toContain(key('codeGroup'));
    expect(titles('code gr')).toEqual([key('codeGroup')]);
    // A word may come from a keyword: "api" is a keyword of Request example, "example" is in its title.
    expect(titles('api example')).toEqual(expect.arrayContaining([key('requestExample'), key('responseExample')]));
  });

  it('ignores letter case, extra spaces and the separators inside names', () => {
    expect(first('CODE BLOCK')).toBe(key('codeBlock'));
    expect(first('  code    block  ')).toBe(key('codeBlock'));
    expect(first('code\tblock')).toBe(key('codeBlock'));
    expect(first('todo')).toBe(key('todo'));
    expect(first('to do')).toBe(key('todo'));
    expect(first('codeblock')).toBe(key('codeBlock'));
  });

  it('returns nothing when any word matches no block', () => {
    expect(titles('zzz')).toEqual([]);
    // Words match from their start: "ock" is inside "block" but starts no word.
    expect(titles('ock')).toEqual([]);
    expect(titles('code lock')).toEqual([]);
    expect(titles('code zzz')).toEqual([]);
    expect(titles('block group')).toEqual([]);
  });
});

describe('slash ranking', () => {
  it('puts Code block before Code group for "/code"', () => {
    expect(titles('code').slice(0, 2)).toEqual([key('codeBlock'), key('codeGroup')]);
    expect(first('cod')).toBe(key('codeBlock'));
  });

  it('lists Note, first, with every callout for "/call" and "/callout"', () => {
    const callouts = ['note', 'tip', 'info', 'check', 'warning', 'danger'].map(key);
    for (const query of ['call', 'callout']) {
      expect(titles(query)).toEqual(expect.arrayContaining(callouts));
      expect(first(query)).toBe(key('note'));
    }
  });

  it('ranks an exact title, then a title prefix, then title words, then keywords', () => {
    // Check is an exact title; To-do list only has the keyword "checkbox".
    expect(titles('check').slice(0, 2)).toEqual([key('check'), key('todo')]);
    // Table and Tabs both start with "tab"; Table is used more.
    expect(titles('tab').slice(0, 2)).toEqual([key('table'), key('tabs')]);
    // A title word (3-card grid) beats a keyword (Table's "grid").
    expect(titles('grid').indexOf(key('cardGrid3'))).toBeLessThan(titles('grid').indexOf(key('table')));
    expect(first('heading')).toBe(key('h1'));
    expect(first('list')).toBe(key('bulletList'));
  });
});

describe('slash search in other languages', () => {
  const ar = (name: string) => translateFn(key(name), undefined, 'ar');

  it('finds blocks by their full Arabic names, and by any of their words', () => {
    expect(first(ar('codeBlock'), 'ar')).toBe(key('codeBlock'));
    expect(first(ar('cardGroup'), 'ar')).toBe(key('cardGroup'));
    expect(first(ar('apiExample'), 'ar')).toBe(key('apiExample'));
    expect(first('مجموعة بطاقات', 'ar')).toBe(key('cardGroup'));
    // A word without its article: "ملفات" finds "شجرة الملفات".
    expect(first('ملفات', 'ar')).toBe(key('fileTree'));
    // English names still work in an Arabic menu, and Arabic ones in an English menu.
    expect(first('code block', 'ar')).toBe(key('codeBlock'));
    expect(first('كتلة شيفرة', 'en')).toBe(key('codeBlock'));
    // Every callout answers to the Arabic word for callout.
    expect(titles('تنبيه', 'ar')).toEqual(expect.arrayContaining(['note', 'tip', 'info', 'check', 'warning', 'danger'].map(key)));
  });

  it('ignores Arabic diacritics and letter variants', () => {
    // The catalog writes "مرقّمة" with a shadda; writers rarely type it.
    expect(ar('numberedList')).toContain('ّ');
    expect(first('قائمة مرقمة', 'ar')).toBe(key('numberedList'));
    expect(first('مرقمه', 'ar')).toBe(key('numberedList'));
    expect(first('قَائِمَة مُرَقَّمَة', 'ar')).toBe(key('numberedList'));
    expect(first('ملاحظـــة', 'ar')).toBe(key('note'));
  });

  it('ignores Latin accents both ways', () => {
    expect(first('etapes', 'fr')).toBe(key('steps'));
    expect(first('liste numerotee', 'fr')).toBe(key('numberedList'));
    expect(first('uberschrift 2', 'de')).toBe(key('h2'));
    expect(first('códe blöck')).toBe(key('codeBlock'));
  });
});

describe('slash menu sections', () => {
  it('files every block under one of the six named sections', () => {
    const sections: MessageKey[] = [
      'editor.slash.basicBlocks',
      'editor.slash.section.callouts',
      'editor.slash.section.media',
      'editor.slash.section.layout',
      'editor.slash.section.api',
      'editor.slash.section.inline',
    ];
    for (const item of items) expect(sections).toContain(slashSection(item));
    expect(new Set(items.map(slashSection))).toEqual(new Set(sections));
    expect(slashSection(itemNamed('paramField'))).toBe('editor.slash.section.api');
    expect(slashSection(itemNamed('tabs'))).toBe('editor.slash.section.layout');
    expect(slashSection(itemNamed('tooltip'))).toBe('editor.slash.section.inline');
  });

  it('labels the new sections in English and Arabic', () => {
    for (const [section, english] of [
      ['editor.slash.section.suggested', 'Suggested'],
      ['editor.slash.section.layout', 'Layout'],
      ['editor.slash.section.api', 'API & code'],
      ['editor.slash.section.inline', 'Inline'],
    ] as const) {
      expect(translateFn(section, undefined, 'en')).toBe(english);
      const arabic = translateFn(section, undefined, 'ar');
      expect(arabic).not.toBe(english);
      expect(arabic).not.toBe(section);
    }
  });

  it('jumps between sections with PageDown and PageUp', () => {
    // Sections start at 0, 6 and 10 in a 14-option list.
    const starts = [0, 6, 10];
    expect(nextSlashSelection(2, 14, 'PageDown', starts)).toBe(6);
    expect(nextSlashSelection(6, 14, 'PageDown', starts)).toBe(10);
    expect(nextSlashSelection(11, 14, 'PageDown', starts)).toBe(13);
    expect(nextSlashSelection(8, 14, 'PageUp', starts)).toBe(6);
    expect(nextSlashSelection(6, 14, 'PageUp', starts)).toBe(0);
    expect(nextSlashSelection(0, 14, 'PageUp', starts)).toBe(0);
  });
});
