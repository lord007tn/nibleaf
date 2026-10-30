// Disposable rehearsal fixture. It patches a copy of scripts/site-preview-mock.mjs
// in memory; the mock file and all product code stay unchanged.
//
// Adds, on top of the bilingual four-theme mock:
//   - pages with subpages (two levels deep) so the reader sidebar can collapse
//   - a long "Port catalog" group so the sidebar has to scroll
//   - a page with a Mermaid fence
//   - AI capability variants: preview-ai-on, preview-ai-off, preview-ai-legacy (no `capabilities`)
//   - a mocked answer endpoint and search hits
//   - a pass-through to a local API (REHEARSAL_UPSTREAM) for every path the mock does not own,
//     so signed-in dashboard pages talk to a throwaway local API and database.
import { readFile } from 'node:fs/promises';

let source = await readFile(new URL('../site-preview-mock.mjs', import.meta.url), 'utf8');
const replace = (before, after) => {
  if (!source.includes(before)) throw new Error(`Missing fixture insertion: ${before.slice(0, 80)}`);
  source = source.replace(before, () => after);
};

replace("import { createServer } from 'node:http';", "import { createServer, request as forwardRequest } from 'node:http';");

replace(
  `const PROJECTS = {
  'preview-harbor': { preset: 'harbor' },
  'preview-manuscript': { preset: 'manuscript' },
  'preview-signal': { preset: 'signal' },
  'preview-legacy': { preset: null },
};`,
  `const PROJECTS = {
  'preview-harbor': { preset: 'harbor', capabilities: { answer: false } },
  'preview-manuscript': { preset: 'manuscript', capabilities: { answer: false } },
  'preview-signal': { preset: 'signal', capabilities: { answer: false } },
  'preview-legacy': { preset: null, capabilities: { answer: false } },
  'preview-ai-on': { preset: 'harbor', capabilities: { answer: true }, aiAnswers: true },
  'preview-ai-off': { preset: 'harbor', capabilities: { answer: false }, aiAnswers: true },
  // An older API omits \`capabilities\` entirely.
  'preview-ai-legacy': { preset: 'harbor', aiAnswers: true },
};`,
);

replace(
  'const pagePath =',
  `
const fixturePage = (group, slug, parent, en, ar, extra = { en: '', ar: '' }) => {
  PAGES.push({
    group, slug, parent, icon: 'file-text',
    en: { title: en, description: en + ' rehearsal page.', content: 'Rehearsal content for ' + en + '.' + extra.en },
    ar: { title: ar, description: 'صفحة تجريبية: ' + ar + '.', content: 'محتوى تجريبي لصفحة ' + ar + '.' + extra.ar },
  });
};
fixturePage('guides', 'auth-api-keys', 'authentication', 'API keys', 'مفاتيح API');
fixturePage('guides', 'auth-oauth', 'authentication', 'OAuth', 'أوث');
fixturePage('guides', 'auth-oauth-pkce', 'auth-oauth', 'PKCE flow', 'تدفق PKCE');
fixturePage('guides', 'webhook-retries', 'webhooks', 'Webhook retries', 'إعادة محاولة الويب هوك');
fixturePage('guides', 'webhook-signatures', 'webhooks', 'Webhook signatures', 'تواقيع الويب هوك');
fixturePage('reference', 'shipments-create', 'shipments', 'Create a shipment', 'إنشاء شحنة');
fixturePage('getting-started', 'architecture-diagram', undefined, 'Architecture diagram', 'مخطط البنية', {
  en: '\\n\\n\`\`\`mermaid\\nflowchart LR\\n  A[Your app] --> B[Tidewater API]\\n  B --> C[Carrier network]\\n  B --> D[Webhooks]\\n\`\`\`\\n\\nAfter the diagram.',
  ar: '\\n\\n\`\`\`mermaid\\nflowchart LR\\n  A[تطبيقك] --> B[واجهة تايدووتر]\\n  B --> C[شبكة الناقلين]\\n  B --> D[الويب هوك]\\n\`\`\`\\n\\nبعد المخطط.',
});
GROUPS.push({ slug: 'catalog', icon: 'list', title: { en: 'Port catalog', ar: 'دليل الموانئ' } });
for (let index = 1; index <= 40; index++) {
  const number = String(index).padStart(2, '0');
  fixturePage('catalog', 'port-' + number, undefined, 'Port ' + number, 'الميناء ' + number);
}
const pagePath =`,
);

// Nest pages under their parent page; only pages without a parent sit directly in a group.
replace(
  `    children: PAGES.filter((page) => page.group === group.slug).map((page) => ({
      id: pageId(page, lang),
      kind: 'PAGE',
      title: page[lang].title,
      path: pagePath(page),
      icon: page.icon ?? null,
      tag: page.tag ?? null,
      children: [],
    })),`,
  `    children: PAGES.filter((page) => page.group === group.slug && !page.parent).map(function pageNode(page) {
      return {
        id: pageId(page, lang),
        kind: 'PAGE',
        title: page[lang].title,
        path: pagePath(page),
        icon: page.icon ?? null,
        tag: page.tag ?? null,
        children: PAGES.filter((child) => child.group === page.group && child.parent === page.slug).map(pageNode),
      };
    }),`,
);

replace(
  '      json(res, 200, { data: siteShell(id, project.preset, searchParams) });',
  `      const shell = siteShell(id, project.preset, searchParams);
      if (project.capabilities) shell.capabilities = project.capabilities;
      if (project.aiAnswers) shell.project.config = { ...shell.project.config, search: { ...shell.project.config.search, aiAnswers: true } };
      json(res, 200, { data: shell });`,
);

replace(
  'json(res, 200, { data: { hits: [] } });',
  `json(res, 200, { data: { hits: PAGES.flatMap((page) => ['en', 'ar'].map((lang) => ({
  id: pageId(page, lang), path: pagePath(page), title: page[lang].title,
  description: page[lang].description, snippet: page[lang].description, score: 1, language: lang, icon: page.icon,
}))).filter((hit) => hit.language === (searchParams.get('lang') || 'en') && hit.title.toLowerCase().includes((searchParams.get('q') || '').toLowerCase())).slice(0, 8) } });`,
);

replace(
  'const server = createServer((req, res) => {',
  `const answerRequests = [];
const UPSTREAM = process.env.REHEARSAL_UPSTREAM ? new URL(process.env.REHEARSAL_UPSTREAM) : null;
const proxy = (req, res) => {
  const forward = forwardRequest(
    { hostname: UPSTREAM.hostname, port: UPSTREAM.port, method: req.method, path: req.url, headers: req.headers },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  forward.on('error', (error) => {
    if (res.headersSent) res.destroy();
    else json(res, 502, { error: { code: 'rehearsal:upstream', message: error.message } });
  });
  req.pipe(forward);
};
const server = createServer((req, res) => {`,
);

replace(
  "  if (pathname.startsWith('/api/public/assets/')) {",
  `  if (pathname === '/__rehearsal') {
    json(res, 200, { answers: answerRequests });
    return;
  }
  const answerMatch = /^\\/api\\/public\\/sites\\/([^/]+)\\/answer$/.exec(pathname);
  if (answerMatch && PROJECTS[answerMatch[1]] && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const input = JSON.parse(body || '{}');
      answerRequests.push({ projectId: answerMatch[1], ...input });
      if (PROJECTS[answerMatch[1]].capabilities?.answer !== true) {
        json(res, 404, { error: { code: 'http:not_found', message: 'AI answers are not available.' } });
        return;
      }
      const ar = input.lang === 'ar';
      const page = PAGES.find((item) => item.slug === 'auth-api-keys');
      json(res, 200, { data: {
        status: 'answered',
        answer: ar ? 'إجابة تجريبية: استخدم مفتاح API في ترويسة التفويض.' : 'Rehearsal answer: send your API key in the Authorization header.',
        confidence: 0.9,
        citations: [{ id: 'c1', pageId: pageId(page, ar ? 'ar' : 'en'), title: page[ar ? 'ar' : 'en'].title, path: pagePath(page), snippet: page[ar ? 'ar' : 'en'].description, direction: ar ? 'rtl' : 'ltr' }],
        model: 'rehearsal-mock',
        cacheHit: false,
        quotaRemaining: 99,
      } });
    });
    return;
  }
  if (pathname.startsWith('/api/public/assets/')) {`,
);

replace(
  `  if (pathname.startsWith('/api/')) {
    res.writeHead(204, { 'cache-control': 'no-store' });`,
  `  // Analytics and feedback for the mocked reader sites stay inside the mock.
  if (match && PROJECTS[match[1]]) {
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  if (UPSTREAM) {
    proxy(req, res);
    return;
  }
  if (pathname.startsWith('/api/')) {
    res.writeHead(204, { 'cache-control': 'no-store' });`,
);

if (process.argv.includes('--check')) {
  console.log('Fixture insertions: pass');
} else {
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}
