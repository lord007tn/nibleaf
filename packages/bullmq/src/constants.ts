// Queue names are the single source of truth for the BullMQ topology. Every
// queue, worker, processor registry, and job-data map keys off these values.

export const QueueNames = {
  PUBLISH: 'publish',
  SEARCH: 'search',
  EMAIL: 'email',
  ANALYTICS: 'analytics',
} as const;
export type QueueNames = (typeof QueueNames)[keyof typeof QueueNames];
