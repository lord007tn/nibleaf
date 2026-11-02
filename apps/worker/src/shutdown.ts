import { createLogger } from '@nibleaf/logger';

const log = createLogger({ component: 'worker-shutdown' });

/** One drain attempt, with a deadline shorter than Compose's 45-second grace. */
export function createWorkerShutdown({
  cleanup,
  unready,
  exit = (code: number) => process.exit(code),
  timeoutMs = 30_000,
}: {
  cleanup: () => Promise<void>;
  unready: () => void;
  exit?: (code: number) => void;
  timeoutMs?: number;
}) {
  let pending: Promise<void> | undefined;
  return (reason: string, exitCode = 0): Promise<void> => {
    if (pending) return pending;
    unready();
    pending = (async () => {
      log.info({ reason, exitCode }, 'Draining worker before shutdown');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const drained = await Promise.race([
          Promise.resolve()
            .then(cleanup)
            .then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), timeoutMs);
            timer.unref();
          }),
        ]);
        if (!drained) log.error({ event: 'worker_shutdown_timeout' }, 'Worker drain deadline exceeded; queued jobs remain for recovery');
        exit(drained ? exitCode : 1);
      } catch {
        log.error({ event: 'worker_shutdown_failed' }, 'Worker cleanup failed');
        exit(1);
      } finally {
        clearTimeout(timer);
      }
    })();
    return pending;
  };
}
