import { readFileSync } from 'node:fs';
import { type Locale, type MessageKey, translateFn } from '@nibleaf/i18n';
import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { type ScopedMessages, scopedTranslate } from '@nibleaf/i18n/scoped';
import { describe, expect, it } from 'vitest';
import { createSlashItems } from '@/components/editor/extensions/slash-command';
import { SLASH_TITLE_MESSAGES } from '@/components/editor/extensions/slash-items/title-messages';
import { PAGE_LANGUAGE_MESSAGES } from '@/components/editor/page-language-messages';
import { ARABIC_SEO_MESSAGES } from '@/components/marketing/arabic-seo-messages';
import { BLOG_MESSAGES } from '@/components/marketing/blog-messages';
import { THEME_PREVIEW_MESSAGES } from '@/features/site-theme/theme-preview-messages';
import { EXPORT_SIZE_MESSAGES } from '@/lib/export-file-size';

const english = JSON.parse(readFileSync(new URL('../../../../packages/i18n/messages/en.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const idOf = (message: unknown) => (message as { name?: string }).name;

/** Every placeholder any English template of `message` declares, with a sample value. */
function sampleVariables(message: unknown): Record<string, string> {
  const template = JSON.stringify(english[idOf(message) ?? ''] ?? '');
  return { ...Object.fromEntries([...template.matchAll(/\{(\w+)\}/g)].map((match) => [match[1], '7'])), count: '7' };
}

describe.each<[string, ScopedMessages]>([
  ['blog', BLOG_MESSAGES],
  ['Arabic comparison page', ARABIC_SEO_MESSAGES],
  ['Theme preview', THEME_PREVIEW_MESSAGES],
  ['page-language editor text', PAGE_LANGUAGE_MESSAGES],
  ['slash command titles', SLASH_TITLE_MESSAGES],
  ['export sizes', EXPORT_SIZE_MESSAGES],
])('%s messages', (_name, messages) => {
  it('read exactly what the full catalog reads, in every locale', () => {
    for (const [key, message] of Object.entries(messages)) {
      const variables = sampleVariables(message);
      for (const { code } of INTERFACE_LOCALES) {
        expect(scopedTranslate(messages, key, variables, code as Locale), `${code}:${key}`).toBe(
          translateFn(key as MessageKey, variables, code as Locale),
        );
      }
    }
  });
});

it('covers the title of every slash command', () => {
  for (const item of createSlashItems()) expect(SLASH_TITLE_MESSAGES).toHaveProperty([item.titleKey]);
});
