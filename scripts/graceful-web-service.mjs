import { spawn } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';

const entrypoint = process.argv[2];
if (!entrypoint) throw new Error('Usage: node scripts/graceful-web-service.mjs <server-entrypoint>');

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
