import { describe, expect, it } from 'vitest';
import { QueueNames } from '../constants';
import { QUEUE_CONFIGS } from './queue';

describe('erasure queue', () => {
  it('retries erasure across outages and retains exhausted jobs for an operator', () => {
    expect(QUEUE_CONFIGS[QueueNames.ERASURE].defaultJobOptions).toMatchObject({
      attempts: 16,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnFail: false,
    });
  });
});
