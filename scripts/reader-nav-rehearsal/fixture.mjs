// Disposable API fixtures; production reader code remains unchanged.
import { readFile } from 'node:fs/promises';

let source = await readFile(new URL('../site-preview-mock.mjs', import.meta.url), 'utf8');
const replace = (before, after) => {
  if (!source.includes(before)) throw new Error(`Missing fixture insertion: ${before}`);
  source = source.replace(before, after);
};
replace("const VERSIONS = [{ id: 'ver_latest', name: 'Latest', slug: 'latest', isDefault: true }];", "const VERSIONS = [{ id: 'ver_latest', name: 'Latest', slug: 'latest', isDefault: true }, { id: 'ver_v2', name: 'V2', slug: 'v2', isDefault: false }, { id: 'ver_refused', name: 'Refused', slug: 'refused', isDefault: false }];");
replace('const resolveVersion = (version) =>', "const resolveVersion = (version) => version === 'refused' ? VERSIONS[0] :");
replace('const server = createServer((req, res) => {', `
const recordedEvents = [];
const shellRequests = [];
const server = createServer((req, res) => {`);
replace("  if (pathname.startsWith('/api/public/assets/')) {", `
  if (pathname === '/__matrix') {
    json(res, 200, {events: recordedEvents, shells: shellRequests});
    return;
  }
  if (req.method === 'POST' && pathname.endsWith('/events')) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      const event = JSON.parse(body);
      recordedEvents.push({name: event.payload.name, path: event.payload.path, language: event.payload.language});
      res.writeHead(204); res.end();
    });
    return;
  }
  if (pathname.startsWith('/api/public/assets/')) {`);
replace("      json(res, 200, { data: siteShell(id, project.preset, searchParams) });", `
      shellRequests.push({lang: searchParams.get('lang'), version: searchParams.get('version')});
      setTimeout(() => json(res, 200, { data: siteShell(id, project.preset, searchParams) }), 1300);`);
replace('const pagePath =', `
PAGES.push({ group: 'reference', slug: 'البداية', icon: 'book-open',
  en: { title: 'Matrix English', description: 'English navigation fixture.', content: 'A page with an Arabic slug.' },
  ar: { title: 'مصفوفة عربية', description: 'صفحة اختبار التنقل العربية.', content: 'صفحة بمسار عربي.' }
});
for (const page of PAGES) {
  for (const lang of ['en', 'ar']) {
    page[lang].content += '\\n\\n[Matrix cross fragment](/reference/البداية#matrix-end)\\n\\n[Matrix same fragment](#matrix-end)\\n\\n' +
      Array.from({length: 35}, (_, i) => 'Paragraph ' + i + ': Reader navigation fixture content.').join('\\n\\n') + '\\n\\n## matrix-end\\n\\nDestination fragment.' + Array.from({length: 15}, () => '\\n\\nContent after the target.').join('');
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
  description: page[lang].description, snippet: page[lang].description, score: 1, language: lang, icon: page.icon
}))).filter(hit => hit.title.includes(searchParams.get('q') || '')) } });`);
if (process.argv.includes('--check')) {
  const fixture = new Function(source.slice(0, source.indexOf('const json =')).replace(/^#!.*\n/, '').replace("import { createServer } from 'node:http';", '') + '; return PAGES[0].en.content;')();
  if (!fixture.includes('\n\n## matrix-end\n')) throw new Error('Fragment fixture did not contain Markdown newlines');
  console.log('Fixture compilation and Markdown newlines: pass');
} else {
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
