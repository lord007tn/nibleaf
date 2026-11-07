import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const envFile = new URL('../.env', import.meta.url);
if (!existsSync(envFile)) {
  console.error('Copy .env.example to .env first');
  process.exit(1);
}
loadEnvFile(envFile);
const mode = process.argv[2] ?? 'app';
const filters = {
  app: ['-F', '@nibleaf/server', '-F', '@nibleaf/worker', '-F', '@nibleaf/app'],
  full: [],
};
if (!Object.hasOwn(filters, mode)) throw new Error('Usage: node scripts/dev.mjs [app|full]');
const child = spawn(
  process.execPath,
  [fileURLToPath(new URL('../node_modules/turbo/bin/turbo', import.meta.url)), 'watch', 'dev', ...filters[mode]],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
  },
);
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill(signal);
  });
}
child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  process.exitCode = code ?? (shuttingDown && signal ? 0 : 1);
});
