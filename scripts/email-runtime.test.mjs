import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

test('renders a verification email through the production TSX runtime', () => {
  const tsx = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
  const source = [
    "import { renderVerificationCodeEmail } from '@nibleaf/email';",
    "void (async () => { const email = await renderVerificationCodeEmail({ code: '123456', purpose: 'sign-in' });",
    "console.log(JSON.stringify({ subject: email.subject, hasCode: email.html.includes('123456'), hasText: email.text.includes('123456') })); })();",
  ].join('\n');
  const result = spawnSync(process.execPath, [tsx, '-e', source], {
    cwd: fileURLToPath(new URL('../apps/server', import.meta.url)),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = result.stdout.trim().split(/\r?\n/u).at(-1);
  assert.ok(output, 'expected the email renderer to emit its verification result');
  assert.deepEqual(JSON.parse(output), {
    hasCode: true,
    hasText: true,
    subject: 'Your Nibleaf sign-in code',
  });
});
