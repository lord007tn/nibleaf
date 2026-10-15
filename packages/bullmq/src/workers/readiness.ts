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

async function connected(worker: ReadinessWorker, timeoutMs: number): Promise<boolean> {
  if (!worker.isRunning()) return false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const [client, blockingClient] = await Promise.all([worker.client, worker.blockingClient]);
        if (client.status !== 'ready' || (blockingClient && blockingClient.status !== 'ready')) return false;
        await client.hget(worker.key, 'version');
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
