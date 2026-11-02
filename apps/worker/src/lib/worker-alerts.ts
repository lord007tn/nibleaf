import { readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@nibleaf/logger';
import { env } from '../env';
import { deliverEmail } from '../processors/email';

const log = createLogger({ component: 'worker-alerts' });
const COOLDOWN_MS = 15 * 60_000;

/** The cooldown survives process/container restarts; alerts bypass BullMQ. */
export function createWorkerAlertSender({
  recipient = env.WORKER_ALERT_EMAIL,
  stateFile = join(tmpdir(), 'nibleaf-worker-alert-cooldown.json'),
  send = deliverEmail,
  now = Date.now,
} = {}) {
  let sending = false;
  return async (summary: string): Promise<void> => {
    if (!recipient || sending) return;
    sending = true;
    try {
      let lastAttempt: number | null = null;
      try {
        const state: unknown = JSON.parse(await readFile(stateFile, 'utf8'));
        if (state && typeof state === 'object' && 'at' in state && typeof state.at === 'number') lastAttempt = state.at;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      const at = now();
      if (lastAttempt !== null && at - lastAttempt < COOLDOWN_MS) return;
      // Record attempts before network I/O so a provider outage or restart cannot
      // create an alert storm. No credentials or customer data go in this file.
      const temporary = `${stateFile}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify({ at }), { mode: 0o600 });
      await rename(temporary, stateFile);
      const text = `Nibleaf worker requires attention.\n\n${summary}\n\nRevision: ${process.env.NIBLEAF_REVISION ?? 'development'}`;
      const detail = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      const result = await send({
        to: recipient,
        subject: 'Nibleaf worker delivery alert',
        text,
        html: `<pre>${detail}</pre>`,
      });
      if (!result.sent) throw new Error('Alert provider is not configured.');
      log.info({ event: 'worker_alert_sent' }, 'Worker operations alert accepted by provider');
    } catch {
      log.error({ event: 'worker_alert_failed' }, 'Worker operations alert could not be delivered');
    } finally {
      sending = false;
    }
  };
}
