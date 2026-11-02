import { getQueue, isQueueEnabled, QueueNames } from '@nibleaf/bullmq';
import { getWorkerHealth, type QueueWorkerHealth } from '@nibleaf/bullmq/workers';
import { createLogger } from '@nibleaf/logger';

const log = createLogger({ component: 'worker-monitor' });
const WORKER_RECOVERY_AFTER_MS = 60_000;
const EMAIL_BACKLOG_ALERT_AFTER_MS = 30_000;

async function inspectEmailBacklog(): Promise<number> {
  if (!isQueueEnabled(QueueNames.EMAIL)) return 0;
  const jobs = await getQueue(QueueNames.EMAIL).getJobs(['waiting', 'active', 'delayed'], 0, 0, true);
  const oldest = Math.min(...jobs.map((job) => job.timestamp));
  return Number.isFinite(oldest) ? Math.max(0, Date.now() - oldest) : 0;
}

/** Observe the real consumers, allow reconnects, then leave recovery to Docker. */
export function startWorkerMonitor({
  restart,
  alert,
  inspect = getWorkerHealth,
  backlog = inspectEmailBacklog,
  intervalMs = 10_000,
  recoveryAfterMs = WORKER_RECOVERY_AFTER_MS,
  now = Date.now,
}: {
  restart: () => void;
  alert: (summary: string) => Promise<void>;
  inspect?: () => Promise<QueueWorkerHealth[]>;
  backlog?: () => Promise<number>;
  intervalMs?: number;
  recoveryAfterMs?: number;
  now?: () => number;
}) {
  let stopped = false;
  let checking = false;
  let failedSince: number | null = null;
  let previousState = '';
  let previousAlert = '';
  let pendingBacklog: Promise<number> | undefined;
  let restarting = false;
  const readBacklog = async () => {
    if (!pendingBacklog) {
      const pending = Promise.resolve().then(backlog);
      pendingBacklog = pending;
      const release = () => {
        if (pendingBacklog === pending) pendingBacklog = undefined;
      };
      void pending.then(release, release);
    }
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pendingBacklog,
        new Promise<never>((_, reject) => {
          deadline = setTimeout(() => reject(new Error('Email backlog probe timed out.')), 1000);
        }),
      ]);
    } finally {
      clearTimeout(deadline);
    }
  };
  const check = async () => {
    if (stopped || checking) return;
    checking = true;
    try {
      let workers: QueueWorkerHealth[] = [];
      try {
        workers = await inspect();
      } catch {
        log.error({ event: 'worker_probe_failed' }, 'Could not inspect owned queue connections');
      }
      if (stopped) return;
      const ready = workers.length > 0 && workers.every((worker) => worker.ready);
      if (ready) failedSince = null;
      else failedSince ??= now();
      const state = JSON.stringify(workers);
      if (state !== previousState) {
        previousState = state;
        log.info({ event: 'worker_queue_health_changed', workers }, 'Queue consumer health changed');
      }
      const unhealthyForMs = failedSince === null ? 0 : now() - failedSince;
      let oldestEmailAgeMs = 0;
      try {
        oldestEmailAgeMs = await readBacklog();
      } catch {
        log.error({ event: 'email_backlog_probe_failed' }, 'Could not inspect pending email age');
      }
      if (stopped) return;
      const unhealthy = !ready && unhealthyForMs >= recoveryAfterMs;
      if (unhealthy || oldestEmailAgeMs >= EMAIL_BACKLOG_ALERT_AFTER_MS) {
        const details = { event: 'worker_delivery_alert', unhealthyForMs, oldestEmailAgeMs, workers };
        const alertState = `${unhealthy}:${oldestEmailAgeMs >= EMAIL_BACKLOG_ALERT_AFTER_MS}`;
        if (previousAlert !== alertState) log.error(details, 'Worker delivery requires attention');
        previousAlert = alertState;
        // Give the direct notification a chance to finish before process exit,
        // without allowing its transport to prevent recovery.
        let deadline: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            alert(JSON.stringify(details)),
            new Promise<void>((resolve) => {
              deadline = setTimeout(resolve, 5000);
            }),
          ]);
        } catch {
          log.error({ event: 'worker_alert_failed' }, 'Worker alert failed');
        } finally {
          clearTimeout(deadline);
        }
      } else if (previousAlert) {
        previousAlert = '';
        log.info({ event: 'worker_delivery_recovered' }, 'Worker delivery alert cleared');
      }
      if (unhealthy && !restarting) {
        restarting = true;
        log.error({ event: 'worker_recovery_restart', unhealthyForMs, workers }, 'Restarting worker after sustained queue failure');
        if (!stopped) restart();
      }
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void check(), intervalMs);
  timer.unref();
  void check();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
