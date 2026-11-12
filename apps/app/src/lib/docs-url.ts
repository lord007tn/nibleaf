/** The published documentation, in Arabic for Arabic readers. `path` has no leading slash. */
export const docsUrl = (locale: string, path = '') => `https://docs.nibleaf.com/${locale.startsWith('ar') ? 'ar/' : ''}${path}`;
