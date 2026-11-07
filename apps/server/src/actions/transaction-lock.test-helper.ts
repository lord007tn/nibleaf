/** Model a transaction-held row lock; PostgreSQL suites verify the actual lock. */
export const transactionLock = () => {
  let tail = Promise.resolve();
  return async (work: unknown, client: object) => {
    if (typeof work !== 'function') return Promise.all(work as Promise<unknown>[]);
    let release: (() => void) | undefined;
    const lock = async () => {
      if (release) return [];
      const previous = tail;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      return [];
    };
    try {
      return await work({ ...client, $queryRaw: lock });
    } finally {
      release?.();
    }
  };
};
