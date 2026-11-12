import { docsUrl } from '@/lib/docs-url';

/** Use the published documentation host, including the Arabic edition. */
export const searchAiDocsUrl = (locale: string) => docsUrl(locale, 'self-hosting/search-ai');
