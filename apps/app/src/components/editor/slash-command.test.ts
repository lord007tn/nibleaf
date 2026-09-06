import type { Locale, MessageKey } from '@nibleaf/i18n';
import { translateFn } from '@nibleaf/i18n';
import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import {
  createSlashItems,
  nextSlashSelection,
  resolveSlashAnchor,
  scaffoldLocaleOf,
  shouldHandleSlashTrigger,
  slashPageLocale,
  slashTriggerOffset,
} from './extensions/slash-command';

describe('slash command keyboard selection', () => {
  it('wraps arrow navigation and supports Home/End', () => {
    expect(nextSlashSelection(0, 3, 'ArrowUp')).toBe(2);
    expect(nextSlashSelection(2, 3, 'ArrowDown')).toBe(0);
    expect(nextSlashSelection(1, 3, 'Home')).toBe(0);
    expect(nextSlashSelection(1, 3, 'End')).toBe(2);
  });

  it('does not select from an empty list or consume unrelated keys', () => {
    expect(nextSlashSelection(0, 0, 'ArrowDown')).toBeNull();
    expect(nextSlashSelection(0, 3, 'Escape')).toBeNull();
  });

  it('captures slash only where a command palette can start', () => {
    expect(shouldHandleSlashTrigger('')).toBe(true);
    expect(shouldHandleSlashTrigger(' ')).toBe(true);
    expect(shouldHandleSlashTrigger('a')).toBe(false);
    expect(shouldHandleSlashTrigger('/')).toBe(false);
  });

  it('tracks the complete active slash query', () => {
    expect(slashTriggerOffset('/')).toBe(0);
    expect(slashTriggerOffset('/hea')).toBe(0);
    expect(slashTriggerOffset('hello /hea')).toBe(6);
    expect(slashTriggerOffset('hello/hea')).toBeNull();
    expect(slashTriggerOffset('/heading one')).toBeNull();
    expect(slashTriggerOffset('//hea')).toBeNull();
  });

  it('positions on the first slash transaction before the decoration commits', () => {
    const cursor = { left: 120, right: 121, top: 240, bottom: 260 };
    const coordsAtPos = (position: number) => {
      expect(position).toBe(7);
      return cursor;
    };

    expect(resolveSlashAnchor(() => null, coordsAtPos, 7)).toEqual(cursor);
  });
});

describe('slash command page locale', () => {
  it('prefers an explicit locale over anything on the editor', () => {
    expect(scaffoldLocaleOf({ lang: 'ar', dir: 'rtl' }, 'fr')).toBe('fr');
  });

  it('reads a supported lang from the direction scope', () => {
    expect(scaffoldLocaleOf({ lang: 'ar-SA', dir: 'rtl' })).toBe('ar');
    expect(scaffoldLocaleOf({ lang: 'fr', dir: 'ltr' })).toBe('fr');
  });

  it('falls back to the scope direction: RTL pages are Arabic, others English', () => {
    expect(scaffoldLocaleOf({ lang: 'xx', dir: 'rtl' })).toBe('ar');
    expect(scaffoldLocaleOf({ dir: 'rtl' })).toBe('ar');
    expect(scaffoldLocaleOf({ dir: 'ltr' })).toBe('en');
    expect(scaffoldLocaleOf(null)).toBe('en');
  });

  it('resolves a running editor through its nearest dir wrapper', () => {
    const scoped = (scope: { lang?: string; dir?: string } | null) =>
      ({ view: { dom: { closest: () => scope } } }) as unknown as Pick<Editor, 'view'>;
    expect(slashPageLocale(scoped({ dir: 'rtl' }))).toBe('ar');
    expect(slashPageLocale(scoped({ dir: 'ltr' }))).toBe('en');
    expect(slashPageLocale(scoped(null))).toBe('en');
    expect(slashPageLocale(scoped({ dir: 'ltr' }), 'ur')).toBe('ur');
  });
});

describe('slash command scaffolds', () => {
  const range = { from: 1, to: 2 };

  /** A fake editor whose command chain records every insertContent payload. */
  const recordingEditor = () => {
    const inserted: unknown[] = [];
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    for (const name of ['focus', 'deleteRange', 'setImage', 'setParagraph']) {
      chain[name] = () => chain;
    }
    chain.insertContent = (content: unknown) => {
      inserted.push(content);
      return chain;
    };
    chain.run = () => true;
    const editor = { chain: () => chain } as unknown as Editor;
    return { editor, inserted };
  };

  const insertedBy = (titleKey: MessageKey, locale: Locale): unknown => {
    const item = createSlashItems().find((candidate) => candidate.titleKey === titleKey);
    if (!item) throw new Error(`missing slash item ${titleKey}`);
    const { editor, inserted } = recordingEditor();
    item.command({ editor, range, locale });
    return inserted[0];
  };

  const scaffold = (key: MessageKey, locale: Locale, variables?: Record<string, string | number>) => translateFn(key, variables, locale);

  it('writes block defaults in the page language, not the dashboard locale', () => {
    expect(insertedBy('editor.slash.steps.title', 'ar')).toEqual({
      type: 'mdxSteps',
      content: [
        { type: 'mdxStep', attrs: { title: 'الخطوة الأولى' }, content: [{ type: 'paragraph' }] },
        { type: 'mdxStep', attrs: { title: 'الخطوة الثانية' }, content: [{ type: 'paragraph' }] },
      ],
    });
    expect(insertedBy('editor.slash.card.title', 'ar')).toMatchObject({ attrs: { title: 'عنوان البطاقة', href: '' } });
    expect(insertedBy('editor.slash.card.title', 'en')).toMatchObject({ attrs: { title: 'Card title', href: '' } });
    expect(insertedBy('editor.slash.tabs.title', 'ar')).toMatchObject({
      content: [
        { attrs: { title: scaffold('editor.slash.default.firstTab', 'ar') } },
        { attrs: { title: scaffold('editor.slash.default.secondTab', 'ar') } },
      ],
    });
    expect(insertedBy('editor.slash.accordion.title', 'ar')).toMatchObject({
      content: [
        { attrs: { title: scaffold('editor.slash.default.firstSection', 'ar') } },
        { attrs: { title: scaffold('editor.slash.default.secondSection', 'ar') } },
      ],
    });
    expect(insertedBy('editor.slash.expandable.title', 'ar')).toMatchObject({ attrs: { title: scaffold('editor.slash.default.showDetails', 'ar') } });
    expect(insertedBy('editor.slash.tooltip.title', 'ar')).toMatchObject({
      attrs: { tip: scaffold('editor.slash.default.tooltipText', 'ar') },
      content: [{ type: 'text', text: scaffold('editor.slash.default.term', 'ar') }],
    });
    expect(insertedBy('editor.slash.badge.title', 'ar')).toMatchObject({ content: [{ type: 'text', text: 'جديد' }] });
    expect(insertedBy('editor.slash.button.title', 'ar')).toMatchObject({ content: [{ type: 'text', text: 'زر' }] });
    // Arabic and English scaffolds really differ (guards against a catalog that merely copies English).
    expect(scaffold('editor.slash.default.firstStep', 'ar')).not.toBe(scaffold('editor.slash.default.firstStep', 'en'));
  });

  it('numbers repeated cards and columns in the page language', () => {
    expect(insertedBy('editor.slash.cardGrid3.title', 'ar')).toMatchObject({
      attrs: { cols: '3' },
      content: [{ attrs: { title: 'بطاقة 1' } }, { attrs: { title: 'بطاقة 2' } }, { attrs: { title: 'بطاقة 3' } }],
    });
    expect(insertedBy('editor.slash.cardGroup.title', 'en')).toMatchObject({
      content: [{ attrs: { title: 'Card 1' } }, { attrs: { title: 'Card 2' } }],
    });
    expect(insertedBy('editor.slash.columns2.title', 'ar')).toMatchObject({
      content: [
        { type: 'mdxColumn', content: [{ content: [{ text: 'عمود 1' }] }] },
        { type: 'mdxColumn', content: [{ content: [{ text: 'عمود 2' }] }] },
      ],
    });
    expect(insertedBy('editor.slash.columns4.title', 'en')).toMatchObject({
      content: [{}, {}, {}, { content: [{ content: [{ text: 'Column 4' }] }] }],
    });
  });

  it('keeps code-like defaults identical in every language', () => {
    for (const locale of ['en', 'ar'] as const) {
      expect(insertedBy('editor.slash.update.title', locale)).toMatchObject({ attrs: { label: 'v1.0.0' } });
      expect(insertedBy('editor.slash.paramField.title', locale)).toMatchObject({ attrs: { name: 'id', type: 'string' } });
      expect(insertedBy('editor.slash.responseField.title', locale)).toMatchObject({ attrs: { name: 'id', type: 'string' } });
      expect(insertedBy('editor.slash.icon.title', locale)).toMatchObject({ attrs: { icon: 'star' } });
      expect(insertedBy('editor.slash.codeGroup.title', locale)).toMatchObject({ content: [{ attrs: { language: 'bash' } }] });
    }
  });
});
