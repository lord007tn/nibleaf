// Works the publish queue for browser.mjs with the worker's own processors, and
// without the worker's ops server, so it opens no port. Started by browser.mjs
// from apps/worker (so its `@/` paths resolve) with WORKER_QUEUES=publish.
const { bootWorkers, closeQueueEvents, closeQueues, closeWorkers } = await import('../../../packages/bullmq/src/workers/index.ts');
const { processors } = await import('../../../apps/worker/src/processors.ts');

await bootWorkers(processors);
console.log('publish worker ready');

const stop = async () => {
  await Promise.allSettled([closeWorkers(), closeQueueEvents(), closeQueues()]);
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
