import { describe, expect, it } from 'vitest';
import { QueueNames } from '../constants';
import { ERASURE_JOB_OPTIONS } from '../jobs/erasure';
import { QUEUE_CONFIGS } from './queue';

describe('erasure queue', () => {
  it('sets the erasure retry and retention options as queue defaults', () => {
    expect(QUEUE_CONFIGS[QueueNames.ERASURE].defaultJobOptions).toMatchObject(ERASURE_JOB_OPTIONS);
  });

  it('keeps failed jobs', () => {
    expect(QUEUE_CONFIGS[QueueNames.ERASURE].defaultJobOptions.removeOnFail).toBe(false);
  });
});
