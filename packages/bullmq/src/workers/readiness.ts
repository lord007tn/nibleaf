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

async function connected(worker: ReadinessWorker, timeoutMs: number): Promise<boolean> {
  if (!worker.isRunning()) return false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const [client, blockingClient] = await Promise.all([worker.client, worker.blockingClient]);
        if (client.status !== 'ready' || (blockingClient && blockingClient.status !== 'ready')) return false;
        await readConnection(client, worker.key);
        return worker.isRunning() && client.status === 'ready' && (!blockingClient || blockingClient.status === 'ready');
      })(),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Probe owned worker connections; a fresh Redis client would hide broken ones. */
export async function workersConnected(workers: readonly ReadinessWorker[], timeoutMs = 1000): Promise<boolean> {
  if (workers.length === 0) return false;
  return (await Promise.all(workers.map((worker) => connected(worker, timeoutMs)))).every(Boolean);
}
