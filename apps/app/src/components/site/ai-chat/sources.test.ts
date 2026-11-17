import type { AiChatSource } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { answerSources } from './sources';

const source = (id: string, pageId: string, heading?: string, extra: Partial<AiChatSource> = {}): AiChatSource => ({
  id,
  pageId,
  title: `Title ${pageId}`,
  path: pageId,
  ...(heading ? { heading, anchor: heading.toLowerCase().replaceAll(' ', '-') } : {}),
  snippet: '',
  direction: 'ltr',
  language: 'en',
  ...extra,
});

describe('answer sources', () => {
  it('lists each page once, with its cited sections numbered in citation order', () => {
    const { groups, sections, numberOf } = answerSources([
      source('S3', 'domains', 'Add your domain'),
      source('S1', 'publishing', 'Publish'),
      source('S2', 'domains', 'Wait for the connection'),
    ]);
    expect(groups.map((group) => [group.title, group.sections.map(({ number, source }) => [number, source.heading])])).toEqual([
      [
        'Title domains',
        [
          [1, 'Add your domain'],
          [3, 'Wait for the connection'],
        ],
      ],
      ['Title publishing', [[2, 'Publish']]],
    ]);
    expect(sections.map(({ number }) => number)).toEqual([1, 2, 3]);
    expect([numberOf('S3'), numberOf('S1'), numberOf('S2'), numberOf('S9')]).toEqual([1, 2, 3, undefined]);
  });

  it('gives two citations of one section one number, so no section is listed twice', () => {
    const { groups, sections, numberOf } = answerSources([
      source('S1', 'domains', 'Add your domain'),
      source('S4', 'domains', 'Add your domain', { snippet: 'another chunk of the same section' }),
      source('S2', 'domains'),
      source('S5', 'domains'),
    ]);
    expect(sections).toHaveLength(2);
    expect(groups).toHaveLength(1);
    expect([numberOf('S1'), numberOf('S4'), numberOf('S2'), numberOf('S5')]).toEqual([1, 1, 2, 2]);
    // The first citation of a section is the one shown.
    expect(sections[0]?.source.id).toBe('S1');
  });

  it('keeps a page and its translation apart', () => {
    const { groups } = answerSources([
      source('S1', 'page', 'Install'),
      source('S2', 'page', 'Install', { language: 'ar', direction: 'rtl', title: 'التثبيت' }),
    ]);
    expect(groups.map((group) => [group.title, group.direction])).toEqual([
      ['Title page', 'ltr'],
      ['التثبيت', 'rtl'],
    ]);
  });
});
