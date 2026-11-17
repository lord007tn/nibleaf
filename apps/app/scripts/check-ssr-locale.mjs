import assert from 'node:assert/strict';
import { request } from 'node:http';

// Run against the built app (CI's production smoke step). The server renders a
// product page in the visitor's interface language: the NIBLEAF_LOCALE cookie,
// then Accept-Language, then English. Hydration then has nothing to switch.
const origin = process.argv[2] ?? 'http://127.0.0.1:3000';
const get = (path, headers = {}) =>
  new Promise((resolve, reject) => {
    const req = request(new URL(path, origin), { headers: { host: 'nibleaf.com', accept: 'text/html', ...headers } }, (res) => {
      let html = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        html += chunk;
      });
      res.on('end', () => resolve({ html, headers: res.headers, status: res.statusCode }));
    });
    req.setTimeout(30_000, () => req.destroy(new Error('SSR locale check timed out')));
    req.on('error', reject);
    req.end();
  });

// The auth layout's heading, on every state of both pages (the API is not running here).
const ARABIC = { lang: 'ar', dir: 'rtl', text: 'وثائقك مستضافة وجاهزة.' };
const ENGLISH = { lang: 'en', dir: 'ltr', text: 'Your docs, hosted and ready.' };
const htmlTag = (html) => /<html\b[^>]*>/i.exec(html)?.[0] ?? '';
// The page itself: the document title switches to the interface language after load.
const body = (html) => html.slice(html.search(/<body\b/i));

async function expectPage(path, headers, expected, label) {
  const response = await get(path, headers);
  assert.equal(response.status, 200, `${label}: status`);
  const tag = htmlTag(response.html);
  assert.match(tag, new RegExp(`\\blang="${expected.lang}"`), `${label}: <html lang> in ${tag}`);
  assert.match(tag, new RegExp(`\\bdir="${expected.dir}"`), `${label}: <html dir> in ${tag}`);
  assert.ok(body(response.html).includes(expected.text), `${label}: server HTML is missing "${expected.text}"`);
  if (expected.lang === 'ar') assert.ok(!body(response.html).includes(ENGLISH.text), `${label}: English text in Arabic HTML`);
  assert.equal(response.headers['cache-control'], 'private, no-store', `${label}: locale-dependent HTML must stay out of shared caches`);
  assert.match(response.headers.vary ?? '', /\bCookie\b/i, `${label}: Vary`);
  assert.match(response.headers.vary ?? '', /\bAccept-Language\b/i, `${label}: Vary`);
  return response;
}

for (const path of ['/sign-in', '/sign-up']) {
  await expectPage(path, { cookie: 'NIBLEAF_LOCALE=ar' }, ARABIC, `${path} with the Arabic cookie`);
  await expectPage(path, { 'accept-language': 'ar,en;q=0.5' }, ARABIC, `${path} with Accept-Language: ar`);
  await expectPage(path, { 'accept-language': 'en-US,en;q=0.9' }, ENGLISH, `${path} with Accept-Language: en`);
  await expectPage(path, {}, ENGLISH, `${path} with no preference`);
  await expectPage(
    path,
    { cookie: 'NIBLEAF_LOCALE=en', 'accept-language': 'ar' },
    ENGLISH,
    `${path}: the English cookie wins over Accept-Language: ar`,
  );
  await expectPage(
    path,
    { cookie: 'NIBLEAF_LOCALE=ar', 'accept-language': 'en' },
    ARABIC,
    `${path}: the Arabic cookie wins over Accept-Language: en`,
  );
  console.log(`${path}: Arabic and English server HTML, cookie before Accept-Language, private and Vary`);
}

// Concurrent requests in different languages never leak into each other.
const burst = Array.from({ length: 24 }, (_, index) => (index % 3 === 0 ? ENGLISH : ARABIC));
await Promise.all(
  burst.map((expected, index) =>
    expectPage(
      '/sign-in',
      expected === ARABIC ? { 'accept-language': 'ar' } : { cookie: 'NIBLEAF_LOCALE=en' },
      expected,
      `concurrent request ${index}`,
    ),
  ),
);
console.log(`${burst.length} concurrent sign-in renders in two languages: each in its own language`);
