import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

const base = (process.env.PARITY_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/u, '');
const host = process.env.PARITY_HOST || new URL(base).host;
const headers = { Host: host, 'x-forwarded-proto': process.env.PARITY_PROTO || 'https' };

const request = (path, accept) =>
  new Promise((resolve, reject) => {
    const url = new URL(`${base}${path}`);
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, { headers: { ...headers, Accept: accept } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode || 0,
          ok: (response.statusCode || 0) >= 200 && (response.statusCode || 0) < 300,
          headers: { get: (name) => response.headers[name.toLowerCase()]?.toString() || null },
          text: async () => Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
const markdownPath = (path) => (path === '/' ? '/index.md' : `${path.replace(/\/$/u, '')}.md`);
const fail = (message) => {
  throw new Error(message);
};

const sitemapResponse = await request('/sitemap.xml', 'application/xml');
if (!sitemapResponse.ok) fail(`sitemap.xml returned ${sitemapResponse.status}`);
const sitemap = await sitemapResponse.text();
const canonicalUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
if (canonicalUrls.length === 0) fail('sitemap.xml contained no URLs');

const conciseResponse = await request('/llms.txt', 'text/plain');
const fullResponse = await request('/llms-full.txt', 'text/plain');
const concise = await conciseResponse.text();
const full = await fullResponse.text();
if (!conciseResponse.ok || concise.split(/\r?\n/u).length > 250 || !concise.includes('/guides.md')) {
  fail('llms.txt is missing, overlong, or does not route to the guide academy Markdown');
}
if (!fullResponse.ok) fail(`llms-full.txt returned ${fullResponse.status}`);
for (const canonicalUrl of canonicalUrls) {
  const url = new URL(canonicalUrl);
  const source = `https://${host}${markdownPath(url.pathname)}${url.search}`;
  if (!full.includes(source)) fail(`llms-full.txt is missing ${source}`);
}

const checkPath = async (canonicalUrl) => {
  const url = new URL(canonicalUrl);
  const path = `${url.pathname}${url.search}`;
  const html = await request(path, 'text/html');
  const negotiated = await request(path, 'text/markdown');
  const alias = await request(`${markdownPath(url.pathname)}${url.search}`, 'text/markdown');
  const htmlBody = await html.text();
  const negotiatedBody = await negotiated.text();
  const aliasBody = await alias.text();

  if (!html.ok || !html.headers.get('content-type')?.startsWith('text/html')) fail(`${path}: HTML ${html.status}`);
  if (!htmlBody.includes('rel="canonical"')) fail(`${path}: missing HTML canonical`);
  if (!html.headers.get('link')?.includes('type="text/markdown"')) fail(`${path}: missing HTTP Markdown discovery`);
  if (!negotiated.ok || !negotiated.headers.get('content-type')?.startsWith('text/markdown'))
    fail(`${path}: negotiated Markdown ${negotiated.status}`);
  if (!alias.ok || !alias.headers.get('content-type')?.startsWith('text/markdown')) fail(`${path}: alias Markdown ${alias.status}`);
  if (!negotiated.headers.get('vary')?.toLowerCase().includes('accept')) fail(`${path}: Markdown response missing Vary: Accept`);
  if (!/^# /mu.test(negotiatedBody) || negotiatedBody.length < 80) fail(`${path}: Markdown body is not substantive`);
  if (negotiatedBody !== aliasBody) fail(`${path}: negotiated and alias Markdown differ`);
};

for (let index = 0; index < canonicalUrls.length; index += 5) {
  await Promise.all(canonicalUrls.slice(index, index + 5).map(checkPath));
}

const missing = await request('/definitely-missing-guide.md', 'text/markdown');
const missingBody = await missing.text();
if (missing.status !== 404 || !missing.headers.get('content-type')?.startsWith('text/markdown') || !missingBody.includes('llms.txt')) {
  fail('unknown Markdown path did not return the recoverable Markdown 404');
}

process.stdout.write(`Markdown parity verified for ${canonicalUrls.length} sitemap URLs on ${host}.\n`);
