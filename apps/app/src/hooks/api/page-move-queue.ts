import type { QueryClient } from '@tanstack/react-query';

const queues = new WeakMap<QueryClient, Map<string, Promise<void>>>();

/** TanStack's mutation scope serializes requests, but not onMutate. Hold this
 * lease through rollback and invalidation as well, across hook instances. */
export async function acquirePageMove(client: QueryClient, projectId: string, variables: unknown): Promise<() => void> {
  const queue = queues.get(client) ?? new Map<string, Promise<void>>();
  queues.set(client, queue);
  const previous = queue.get(projectId) ?? Promise.resolve();
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const tail = previous.then(() => finished);
  queue.set(projectId, tail);
  let released = false;
  let unsubscribe: () => void = () => undefined;
  const release = () => {
    if (released) return;
    released = true;
    finish();
    unsubscribe();
    if (queue.get(projectId) === tail) queue.delete(projectId);
  };
  // Session resets clear mutations and suppress their old-session callbacks.
  // A retired session must not leave its queued onMutate promises stranded.
  unsubscribe = client.getMutationCache().subscribe((event) => {
    if (event.type === 'removed' && event.mutation.state.variables === variables) release();
  });
  await previous;
  return release;
}
