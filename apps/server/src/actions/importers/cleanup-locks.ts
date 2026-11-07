import type { Prisma } from '@nibleaf/database';

/**
 * Import cleanups (starter pages, duplicate pages) wait on the project lock,
 * which a Git sync or a structural page update may hold for a while. They are
 * optional work: when the lock stays busy, the page is kept and the import
 * carries on.
 *
 * Prisma's `maxWait` only bounds getting a connection, so each cleanup also
 * caps every lock wait inside its transaction with `lock_timeout`; the blocked
 * statement then fails with SQLSTATE 55P03 instead of waiting out the whole
 * transaction timeout.
 */
export const CLEANUP_TRANSACTION = { timeout: 30_000, maxWait: 10_000 } as const;

/** First statement of a cleanup transaction: give up on any lock after 10 s. */
export const limitCleanupLockWait = (tx: Prisma.TransactionClient) => tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;

const LOCK_NOT_AVAILABLE = '55P03';

const carriesLockTimeout = (value: unknown, depth = 0): boolean => {
  if (!value || typeof value !== 'object' || depth > 4) return false;
  const record = value as Record<string, unknown>;
  if (record.code === LOCK_NOT_AVAILABLE || record.originalCode === LOCK_NOT_AVAILABLE) return true;
  return ['cause', 'meta', 'driverAdapterError'].some((key) => carriesLockTimeout(record[key], depth + 1));
};

/** Whether a cleanup gave up waiting: Prisma's transaction timeout (P2028) or
 * a lock wait cut short by `lock_timeout` (55P03, reported as a raw-query
 * P2010 or through the driver adapter's original code). */
export const isCleanupLockTimeout = (error: unknown): boolean =>
  (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2028') || carriesLockTimeout(error);
