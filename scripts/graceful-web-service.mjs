import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const entrypoint = process.argv[2];
if (!entrypoint) throw new Error('Usage: node scripts/graceful-web-service.mjs <server-entrypoint>');
const output = dirname(dirname(entrypoint));
if (
  (existsSync(join(output, '.nibleaf-runtime-required')) && !existsSync(join(output, '.nibleaf-runtime-configured'))) ||
  /nibleaf-runtime-(?:app|admin|api|site)\.invalid/.test(await readFile(entrypoint, 'utf8'))
) {
  throw new Error(
    `Web runtime configuration is incomplete. Run node scripts/configure-web-runtime.mjs ${output} with APP_URL before starting this service.`,
  );
}

const drainFile = process.env.NIBLEAF_DRAIN_FILE ?? '/tmp/nibleaf-draining';
const drainDelayMs = Number(process.env.NIBLEAF_DRAIN_DELAY_MS ?? 15_000);
const forceExitMs = Number(process.env.NIBLEAF_WEB_FORCE_EXIT_MS ?? 25_000);
if (!Number.isInteger(drainDelayMs) || drainDelayMs < 1000 || drainDelayMs > 60_000)
  throw new Error('NIBLEAF_DRAIN_DELAY_MS must be between 1000 and 60000.');
if (!Number.isInteger(forceExitMs) || forceExitMs < 1000 || forceExitMs > 120_000)
  throw new Error('NIBLEAF_WEB_FORCE_EXIT_MS must be between 1000 and 120000.');

await rm(drainFile, { force: true });
const child = spawn(process.execPath, [entrypoint], { env: { ...process.env, NIBLEAF_DRAIN_FILE: drainFile }, stdio: 'inherit' });
let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  await writeFile(drainFile, `${signal}\n`, { mode: 0o600 });
  process.stdout.write(`[nibleaf] ${signal}: readiness disabled; draining for ${drainDelayMs}ms\n`);
  const forceTimer = setTimeout(() => child.kill('SIGKILL'), drainDelayMs + forceExitMs);
  forceTimer.unref();
  setTimeout(() => child.kill(signal), drainDelayMs).unref();
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

child.once('error', (error) => {
  process.stderr.write(`[nibleaf] web service failed to start: ${error.message}\n`);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  if (signal && !shuttingDown) process.stderr.write(`[nibleaf] web service exited from ${signal}\n`);
  process.exit(shuttingDown ? 0 : (code ?? 1));
});
