// Disposable API fixtures; production reader code remains unchanged.
import { readFile } from 'node:fs/promises';

let source = await readFile(new URL('../site-preview-mock.mjs', import.meta.url), 'utf8');
const replace = (before, after) => {
  if (!source.includes(before)) throw new Error(`Missing fixture insertion: ${before}`);
  source = source.replace(before, after);
};
replace("const VERSIONS = [{ id: 'ver_latest', name: 'Latest', slug: 'latest', isDefault: true }];", "const VERSIONS = [{ id: 'ver_latest', name: 'Latest', slug: 'latest', isDefault: true }, { id: 'ver_v2', name: 'V2', slug: 'v2', isDefault: false }];");
replace('const pagePath =', `
PAGES.push({ group: 'reference', slug: 'البداية', icon: 'book-open',
  en: { title: 'Matrix English', description: 'English navigation fixture.', content: 'A page with an Arabic slug.' },
  ar: { title: 'مصفوفة عربية', description: 'صفحة اختبار التنقل العربية.', content: 'صفحة بمسار عربي.' }
});
for (const page of PAGES) {
  for (const lang of ['en', 'ar']) {
    page[lang].content += '\\n\\n[Matrix cross fragment](/reference/البداية#matrix-end)\\n\\n[Matrix same fragment](#matrix-end)\\n\\n' +
      Array.from({length: 35}, (_, i) => 'Paragraph ' + i + ': Reader navigation fixture content.').join('\\n\\n') + '\\n\\n## matrix-end\\n\\nDestination fragment.';
  }
}
const pagePath =`);
replace("  if (pathname.startsWith('/api/public/assets/')) {", `
  if (pathname === '/api/public/domains/resolve') {
    json(res, 200, {data: {projectId: 'preview-harbor'}});
    return;
  }
  if (pathname.startsWith('/api/public/assets/')) {`);
replace("json(res, 200, { data: { hits: [] } });", `json(res, 200, { data: { hits: PAGES.flatMap(page => ['en', 'ar'].map(lang => ({
  id: pageId(page, lang), path: pagePath(page), title: page[lang].title,
  snippet: page[lang].description, language: lang, icon: page.icon
}))).filter(hit => hit.title.includes(searchParams.get('q') || '')) } });`);
await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
