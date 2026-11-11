import { createStart } from '@tanstack/react-start';
import { apiResponseErrorAdapter } from '@/hooks/api/api-error-serialization';

/** App-wide TanStack Start options: how values cross from the server to the browser. */
export const startInstance = createStart(() => ({
  serializationAdapters: [apiResponseErrorAdapter],
}));
