import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const [htmlPath, headersPath] = process.argv.slice(2);
assert.ok(htmlPath && headersPath, 'Pass the SSR HTML and HTTP response header files');
const html = readFileSync(htmlPath, 'utf8');
const headers = readFileSync(headersPath, 'utf8');
const policy = headers.match(/^content-security-policy:\s*(.+)$/im)?.[1];
const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
assert.ok(nonce, 'SSR response must include a nonce-based Content-Security-Policy');

let executableScripts = 0;
let hydrationScripts = 0;
const { document } = parseHTML(html);
for (const script of document.querySelectorAll('script')) {
  const type = script.getAttribute('type');
  if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
  executableScripts++;
  assert.equal(script.getAttribute('nonce'), nonce, 'Every executable SSR script must match the CSP nonce');
  if (script.hasAttribute('data-tsr-stream-part')) hydrationScripts++;
}
assert.ok(executableScripts > 0, 'SSR must include executable scripts');
assert.ok(hydrationScripts > 0, 'SSR must include the TanStack hydration stream');
console.log(`Verified CSP nonce on ${executableScripts} scripts, including ${hydrationScripts} TanStack hydration scripts`);
