interface WorkerConnection {
  status: string;
  hget(key: string, field: string): Promise<string | null>;
}

interface ReadinessWorker {
  isRunning(): boolean;
  key: string;
  client: Promise<WorkerConnection>;
  blockingClient?: Promise<{ status: string }>;
}

export interface WorkerConnectionHealth {
  ready: boolean;
  reason: 'ready' | 'not-running' | 'client-not-ready' | 'blocking-client-not-ready' | 'read-failed' | 'probe-timeout';
  client: string | null;
  blockingClient: string | null;
}

const connectionStatus = (status: string) =>
  ['wait', 'connecting', 'connect', 'ready', 'close', 'reconnecting', 'end'].includes(status) ? status : 'unknown';

const inFlightReads = new WeakMap<WorkerConnection, Promise<void>>();

function readConnection(client: WorkerConnection, key: string): Promise<void> {
  const existing = inFlightReads.get(client);
  if (existing) return existing;
  const pending = Promise.resolve()
    .then(() => client.hget(key, 'version'))
    .then(() => undefined);
  inFlightReads.set(client, pending);
  const release = () => {
    if (inFlightReads.get(client) === pending) inFlightReads.delete(client);
  };
  // A caller's deadline cannot cancel an ioredis command. Retain one shared
  // read until it settles instead of buffering a new command at every probe.
  void pending.then(release, release);
  return pending;
}

export async function inspectWorkerConnection(worker: ReadinessWorker, timeoutMs = 1000): Promise<WorkerConnectionHealth> {
  const status: WorkerConnectionHealth = { ready: false, reason: 'not-running', client: null, blockingClient: null };
  if (!worker.isRunning()) return status;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const [client, blockingClient] = await Promise.all([worker.client, worker.blockingClient]);
        status.client = connectionStatus(client.status);
        status.blockingClient = blockingClient ? connectionStatus(blockingClient.status) : null;
        if (client.status !== 'ready') return { ...status, reason: 'client-not-ready' as const };
        if (blockingClient && blockingClient.status !== 'ready') return { ...status, reason: 'blocking-client-not-ready' as const };
        await readConnection(client, worker.key);
        status.client = connectionStatus(client.status);
        status.blockingClient = blockingClient ? connectionStatus(blockingClient.status) : null;
        if (!worker.isRunning()) return { ...status, reason: 'not-running' as const };
        if (client.status !== 'ready') return { ...status, reason: 'client-not-ready' as const };
        if (blockingClient && blockingClient.status !== 'ready') return { ...status, reason: 'blocking-client-not-ready' as const };
        return { ...status, ready: true, reason: 'ready' as const };
      })(),
      new Promise<WorkerConnectionHealth>((resolve) => {
        timeout = setTimeout(() => resolve({ ...status, reason: 'probe-timeout' }), timeoutMs);
      }),
    ]);
  } catch {
    return { ...status, reason: 'read-failed' };
  } finally {
    clearTimeout(timeout);
  }
}

/** Probe owned worker connections; a fresh Redis client would hide broken ones. */
export async function workersConnected(workers: readonly ReadinessWorker[], timeoutMs = 1000): Promise<boolean> {
  if (workers.length === 0) return false;
  return (await Promise.all(workers.map((worker) => inspectWorkerConnection(worker, timeoutMs)))).every((status) => status.ready);
}
