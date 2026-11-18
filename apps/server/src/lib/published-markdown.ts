import { logger } from '@nibleaf/logger';
import type { PublicMarkdownPage } from '@nibleaf/shared/public-markdown';
import { normalizePublicMarkdownContent } from '@nibleaf/shared/public-markdown-content';

interface PublishedPage extends PublicMarkdownPage {
  project: { config?: { visibility?: string; seo?: { allowIndex?: boolean } } | null };
  languageConfig?: { seo?: { allowIndex?: boolean } } | null;
  page: {
    id: string;
    title: string;
    description?: string | null;
    content: string;
    config?: { seo?: { noindex?: boolean; canonicalUrl?: string } } | null;
  };
}

/** The page title/summary are reader chrome, so include them ahead of authored body. */
export const buildPublishedPageMarkdown = (data: PublishedPage): string => {
  const parts = [`# ${data.page.title.trim()}`];
  if (data.page.description?.trim()) parts.push(`> ${data.page.description.trim().replace(/\s+/gu, ' ')}`);
  const content = normalizePublicMarkdownContent(data.page.content, {
    pageId: data.page.id,
    onLiteralFallback: ({ pageId }) => logger.info({ pageId }, 'Export literal-text fallback'),
  });
  if (content) parts.push(content);
  return `${parts.join('\n\n')}\n`;
};
