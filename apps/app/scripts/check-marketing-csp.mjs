import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';

// Run against the built app in CI after every framework/Router upgrade. No DOM
// parser shared with the implementation: independently hash the raw script text.
const origin = process.argv[2] ?? 'http://127.0.0.1:3000';
const get = (path, headers = {}, method = 'GET') =>
  new Promise((resolve, reject) => {
    const req = request(new URL(path, origin), { method, headers: { host: 'nibleaf.com', ...headers } }, (res) => {
      let html = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        html += chunk;
      });
      res.on('end', () => resolve({ html, headers: res.headers, status: res.statusCode }));
    });
    req.setTimeout(30_000, () => req.destroy(new Error('Marketing CSP check timed out')));
    req.on('error', reject);
    req.end();
  });
for (const path of [
  '/',
  '/ar',
  '/pricing',
  '/about',
  '/developers',
  '/blog/nibleaf-august-2026-source-release',
  '/blog/nibleaf-august-2026-source-release-ar',
]) {
  const first = await get(path, { 'user-agent': 'Mozilla/5.0 Chrome/130.0' });
  const second = await get(path, { 'user-agent': 'Googlebot', 'accept-language': 'ar,en;q=0.5' });
  assert.equal(first.status, 200, path);
  assert.equal(first.headers['cache-control'], 'public, max-age=60, s-maxage=300', path);
  assert.equal(first.html, second.html, `Non-deterministic HTML for ${path}`);
  assert.equal(first.headers['content-security-policy'], second.headers['content-security-policy'], path);
  const head = await get(path, {}, 'HEAD');
  assert.equal(head.status, 200, path);
  assert.equal(head.headers['cache-control'], first.headers['cache-control'], path);
  assert.equal(head.html, '');
  assert.equal(head.headers['content-security-policy'], first.headers['content-security-policy'], `HEAD policy at ${path}`);
  assert.match(first.headers.vary ?? '', /Accept/i);
  assert.doesNotMatch(first.html, /csp-nonce|<script\b[^>]*\bnonce=/i);
  let scripts = 0;
  for (const match of first.html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const hash = createHash('sha256').update(match[1]).digest('base64');
    assert.ok(first.headers['content-security-policy']?.includes(`'sha256-${hash}'`), `Uncovered inline script at ${path}`);
    scripts++;
  }
  assert.ok(scripts > 0, `Missing hydration scripts at ${path}`);
  for (const headers of [{ cookie: 'better-auth.session_token=fixture' }, { authorization: 'Bearer fixture' }]) {
    const privateResponse = await get(path, headers);
    assert.equal(privateResponse.headers['cache-control'], 'private, no-store', path);
    assert.match(privateResponse.headers['content-security-policy'] ?? '', /nonce-/);
  }
  console.log(`${path}: deterministic human/bot HTML, ${scripts} covered inline scripts, credential bypass`);
}
