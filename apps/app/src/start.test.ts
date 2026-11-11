import { describe, expect, it } from 'vitest';
import { apiResponseErrorAdapter } from '@/hooks/api/api-error-serialization';
import { startInstance } from './start';

/** The marker Start puts on its same-origin request middleware (outside production builds). */
const csrfSymbol = Symbol.for('tanstack-start:csrf-middleware');

describe('start instance', () => {
  it("keeps Start's default request middleware: server functions answer same-origin requests only", async () => {
    const options = await startInstance.getOptions();
    const middleware = options.requestMiddleware ?? [];
    expect(middleware.some((entry) => csrfSymbol in (entry as object))).toBe(true);
  });

  it('registers the API error adapter', async () => {
    const options = await startInstance.getOptions();
    expect(options.serializationAdapters).toContain(apiResponseErrorAdapter);
  });
});
