import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../env', () => ({ env: {} }));
vi.mock('../processors/email', () => ({ deliverEmail: vi.fn() }));
vi.mock('@nibleaf/logger', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

import { createWorkerAlertSender } from './worker-alerts';

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});
const stateFile = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nibleaf-alert-test-'));
  directories.push(directory);
  return join(directory, 'cooldown.json');
};

describe('operations alerts independent of the email queue', () => {
  it('deduplicates concurrent notifications before provider acceptance', async () => {
    const file = await stateFile();
    let release: (value: { sent: boolean }) => void = () => undefined;
    const send = vi.fn(
      () =>
        new Promise<{ sent: boolean }>((resolve) => {
          release = resolve;
        }),
    );
    const notify = createWorkerAlertSender({ recipient: 'operator@example.test', stateFile: file, send });
    const first = notify('queue unavailable');
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await notify('same outage');
    release({ sent: true });
    await first;
    expect(send).toHaveBeenCalledOnce();
  });
  it('sends directly and preserves its cooldown across recreated senders', async () => {
    const file = await stateFile();
    const send = vi.fn().mockResolvedValue({ sent: true });
    let at = 0;
    const options = { recipient: 'operator@example.test', stateFile: file, send, now: () => at };
    await createWorkerAlertSender(options)('queue unavailable');
    await createWorkerAlertSender(options)('still unavailable after restart');
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ at: 0 });
    at = 15 * 60_000;
    await createWorkerAlertSender(options)('still unavailable');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('bounds attempts during provider failure and never needs a recipient queue job', async () => {
    const file = await stateFile();
    const send = vi.fn().mockRejectedValue(new Error('private provider error'));
    const options = { recipient: 'operator@example.test', stateFile: file, send };
    await expect(createWorkerAlertSender(options)('queue unavailable')).resolves.toBeUndefined();
    await createWorkerAlertSender(options)('queue still unavailable');
    expect(send).toHaveBeenCalledOnce();
    expect(await readFile(file, 'utf8')).not.toContain('private');
  });

  it('does not send without an explicitly configured operations recipient', async () => {
    const send = vi.fn();
    await createWorkerAlertSender({ recipient: undefined, send })('queue unavailable');
    expect(send).not.toHaveBeenCalled();
  });
});
