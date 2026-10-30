// Exports .env.example (plus rehearsal overrides) into $GITHUB_ENV for later steps.
// No .env file is written. The auth secret is random per run and masked.
import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

const values = {};
for (const line of readFileSync('.env.example', 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match && match[2] !== '' && !match[1].startsWith('VITE_')) values[match[1]] = match[2];
}
const secret = randomBytes(32).toString('hex');
console.log(`::add-mask::${secret}`);
Object.assign(values, {
  API_PORT: '4312',
  BETTER_AUTH_SECRET: secret,
  PINO_LOG_LEVEL: 'info',
  REHEARSAL_UPSTREAM: 'http://127.0.0.1:4312',
});
delete values.OPENROUTER_API_KEY;
appendFileSync(process.env.GITHUB_ENV, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
console.log(`exported ${Object.keys(values).length} variables (no AI provider key)`);
