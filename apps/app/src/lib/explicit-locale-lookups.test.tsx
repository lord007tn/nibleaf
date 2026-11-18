// @vitest-environment jsdom
import type { Locale, MessageKey, MessageVariables } from '@nibleaf/i18n';
import type { ProjectConfig } from '@nibleaf/validators';
import { Editor } from '@tiptap/core';
import { act, type ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The browser's boundary: the server reads every locale synchronously, and the
// client starts with English alone. Nothing here prepares another catalog, so a
// lookup that depends on one reads English (or its key) and fails.
const boundary = vi.hoisted(() => ({ server: false }));
vi.mock('@nibleaf/i18n/dashboard-catalog', async () => {
  const server = await import('../../../../packages/i18n/src/dashboard-catalog.server');
  const client = await import('../../../../packages/i18n/src/dashboard-catalog.client');
  return { ...client, dashboardMessage: (id: string, locale: Locale) => (boundary.server ? server : client).dashboardMessage(id, locale) };
});
vi.mock('@/lib/first-publish-activation', () => ({
  MARKETING_ANALYTICS_CONSENT_EVENT: 'fixture-consent',
  trackFirstPublishCta: vi.fn(),
  trackFirstPublishLanding: vi.fn(),
}));

import { translateFn } from '@nibleaf/i18n';
import { createSlashItems, rankSlashItems } from '@/components/editor/extensions/slash-command';
import { scaffoldText } from '@/components/editor/extensions/slash-items/types';
import { messageInLanguage } from '@/components/editor/page-tree-utils';
import { buildEditorExtensions } from '@/components/editor/tiptap-editor';
import { ArabicDocumentationPlatformsPage } from '@/components/marketing/arabic-seo';
import { ArticlePage, BlogIndexPage } from '@/components/marketing/blog';
import { ThemePreview } from '@/features/site-theme/components/theme-preview';
import type { BlogEntry } from '@/lib/blog';
import { formatExportFileSize } from '@/lib/export-file-size';

/** What main returns: Paraglide's own message, in the requested locale. */
const mainText = (key: MessageKey, variables: MessageVariables | undefined, locale: Locale): string => {
  boundary.server = true;
  try {
    return translateFn(key, variables, locale);
  } finally {
    boundary.server = false;
  }
};

const containers: HTMLElement[] = [];
afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
  boundary.server = false;
  vi.unstubAllGlobals();
});

/** Server-renders `page`, then hydrates that HTML with only the browser's English catalog. */
async function hydrateServerHtml(page: ReactElement) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  boundary.server = true;
  const html = renderToString(page);
  boundary.server = false;
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.append(container);
  containers.push(container);
  const serverText = container.textContent;
  const errors: unknown[] = [];
  let root!: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, page, { onRecoverableError: (error) => errors.push(error) });
  });
  // A Suspense boundary can leave server HTML in place, so also read what the
  // browser's own first render would produce.
  const probe = document.createElement('div');
  probe.innerHTML = renderToString(page);
  const hydratedText = container.textContent;
  await act(async () => root.unmount());
  expect(probe.textContent).toBe(serverText);
  return { errors, hydratedText, serverText };
}

const ARABIC_ARTICLE: BlogEntry = {
  dateModified: '2026-11-02',
  datePublished: '2026-11-01',
  description: 'وصف تجريبي',
  faqs: [{ answer: 'جواب', question: 'سؤال' }],
  language: 'ar',
  slug: 'fixture-arabic-article',
  title: 'مقال تجريبي',
};

describe('marketing pages keep their server language through hydration', () => {
  it('hydrates the Arabic documentation platforms page in Arabic for an English browser', async () => {
    const { errors, hydratedText, serverText } = await hydrateServerHtml(<ArabicDocumentationPlatformsPage />);
    expect(serverText).toContain(mainText('marketing.arabicSeo.source.pricing', undefined, 'ar'));
    expect(hydratedText).toBe(serverText);
    expect(hydratedText).not.toContain('marketing.arabicSeo');
    expect(errors).toEqual([]);
  });

  it('hydrates an Arabic blog article with Arabic chrome', async () => {
    const { errors, hydratedText, serverText } = await hydrateServerHtml(
      <ArticlePage entry={ARABIC_ARTICLE}>
        <p>نص</p>
      </ArticlePage>,
    );
    for (const key of ['blog.allArticles', 'blog.faqTitle', 'blog.ctaTitle', 'blog.share'] as const) {
      expect(serverText).toContain(mainText(key, undefined, 'ar'));
    }
    expect(hydratedText).toBe(serverText);
    expect(errors).toEqual([]);
  });

  it('keeps the English blog index in English', async () => {
    const { errors, hydratedText, serverText } = await hydrateServerHtml(<BlogIndexPage entries={[]} />);
    expect(serverText).toContain(mainText('blog.title', undefined, 'en'));
    expect(hydratedText).toBe(serverText);
    expect(errors).toEqual([]);
  });
});

describe('Theme settings preview', () => {
  const config = { theme: { version: 1, preset: 'manuscript' } } as unknown as ProjectConfig;

  it('shows the Arabic preview in Arabic while the dashboard is in English', async () => {
    const { errors, hydratedText } = await hydrateServerHtml(<ThemePreview arabic config={config} mode="light" />);
    for (const key of ['settings.theme.preview.productDocs', 'settings.theme.preview.search', 'settings.theme.preview.start'] as const) {
      expect(hydratedText).toContain(mainText(key, undefined, 'ar'));
    }
    expect(hydratedText).not.toContain(mainText('settings.theme.preview.search', undefined, 'en'));
    expect(errors).toEqual([]);
  });
});

describe('editor lookups in another language than the dashboard', () => {
  it('finds every slash command by its English or Arabic title, whichever the dashboard language', () => {
    const items = createSlashItems();
    expect(items.length).toBeGreaterThan(20);
    for (const item of items) {
      for (const locale of ['en', 'ar'] as const) {
        const title = mainText(item.titleKey, undefined, locale);
        expect(
          rankSlashItems(items, title, 'en').map((match) => match.titleKey),
          `${item.titleKey} by "${title}"`,
        ).toContain(item.titleKey);
      }
    }
  });

  it('finds a slash command by its title in the page language', () => {
    const items = createSlashItems();
    const item = items.find((candidate) => mainText(candidate.titleKey, undefined, 'de') !== mainText(candidate.titleKey, undefined, 'en'));
    if (!item) throw new Error('No slash item has its own German title');
    const german = mainText(item.titleKey, undefined, 'de');
    expect(rankSlashItems(items, german, 'de').map((match) => match.titleKey)).toContain(item.titleKey);
  });

  it.each(['ar', 'de', 'ur'] as const)('scaffolds inserted blocks in the %s page language', (locale) => {
    expect(scaffoldText('editor.slash.default.firstStep', locale)).toBe(mainText('editor.slash.default.firstStep', undefined, locale));
    expect(scaffoldText('editor.slash.default.cardN', locale, { n: 2 })).toBe(mainText('editor.slash.default.cardN', { n: 2 }, locale));
    expect(scaffoldText('editor.slash.default.tooltipText', locale)).toBe(mainText('editor.slash.default.tooltipText', undefined, locale));
  });

  it('names a new group in the page language', () => {
    const fallback = vi.fn(() => 'interface fallback');
    expect(messageInLanguage('editor.newGroup', 'ar', fallback)).toBe(mainText('editor.newGroup', undefined, 'ar'));
    expect(messageInLanguage('editor.newGroup', 'x-unknown', fallback)).toBe('interface fallback');
  });

  it('writes the empty-block placeholders in the page language', () => {
    const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ dir: 'rtl', locale: 'ar' }) });
    const placeholder = editor.extensionManager.extensions.find((extension) => extension.name === 'placeholder')?.options.placeholder as (props: {
      node: { type: { name: string } };
    }) => string;
    expect(placeholder({ node: { type: { name: 'heading' } } })).toBe(mainText('editor.placeholder.heading', undefined, 'ar'));
    expect(placeholder({ node: { type: { name: 'paragraph' } } })).toBe(mainText('editor.placeholder.body', undefined, 'ar'));
    editor.destroy();
  });
});

describe('export sizes', () => {
  it('reads the size unit in the requested locale', () => {
    expect(formatExportFileSize(2048, 'ar')).toBe(mainText('settings.exports.workflow.size.kib', { value: '2' }, 'ar'));
  });
});
