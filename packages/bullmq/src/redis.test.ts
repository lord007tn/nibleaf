import { describe, expect, it } from 'vitest';
import { producerConnectionConfig, redisConnectionConfig } from './redis';

describe('Redis wire compatibility', () => {
  it('keeps worker and producer connections on RESP2 during the ioredis 6 upgrade', () => {
    expect(redisConnectionConfig.protocol).toBe(2);
    expect(producerConnectionConfig.protocol).toBe(2);
  });
});
