import { expect, it, vi } from 'vitest';
import { migrateClickHouseSchema } from './initialization';

it.skipIf(process.env.ANALYTICS_LOCK_INTEGRATION !== '1')(
  'serializes separate migration attempts through real Postgres and releases after failure',
  async () => {
    let release: () => void = () => undefined;
    let entered: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const fake = { command: vi.fn(), close: vi.fn(), insert: vi.fn(), query: vi.fn(async () => ({ json: async () => [] })) };
    fake.command.mockImplementationOnce(async () => {
      entered();
      await held;
    });
    const create = vi.fn().mockReturnValue(fake);
    const { prisma } = await import('@nibleaf/database');
    try {
      const first = migrateClickHouseSchema({ create });
      await acquired;
      try {
        expect(await migrateClickHouseSchema({ create })).toBe(false);
        expect(create).toHaveBeenCalledTimes(1);
      } finally {
        release();
      }
      expect(await first).toBe(true);
      fake.command.mockRejectedValueOnce(new Error('synthetic DDL failure'));
      await expect(migrateClickHouseSchema({ create })).rejects.toThrow('synthetic DDL failure');
      expect(await migrateClickHouseSchema({ create })).toBe(true);
    } finally {
      release();
      await prisma.$disconnect();
    }
  },
  30_000,
);
