import { editor_untitled } from '@nibleaf/i18n/messages/editor_untitled';
import { describe, expect, it } from 'vitest';
import { displayTitle } from './page-title';

describe('displayTitle', () => {
  it('keeps a real title as written', () => {
    expect(displayTitle({ title: 'Getting started', languageCode: 'en' })).toBe('Getting started');
  });

  it.each([
    ['en', ''],
    ['en', '   '],
    ['ar', ''],
    ['fr', ''],
  ])('reads "Untitled" in the page language (%s) for an empty title', (languageCode, title) => {
    expect(displayTitle({ title, languageCode })).toBe(editor_untitled(undefined, { locale: languageCode as 'en' }));
  });

  it('falls back to English for a language without an interface catalog', () => {
    expect(displayTitle({ title: '', languageCode: 'it' })).toBe(editor_untitled(undefined, { locale: 'en' }));
    expect(displayTitle({ title: '' })).toBe(editor_untitled(undefined, { locale: 'en' }));
  });
});
