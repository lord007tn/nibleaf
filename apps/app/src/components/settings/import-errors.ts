import { ApiResponseError } from '@/hooks/api/client-helpers';

export const importMayStillRun = (error: unknown): boolean =>
  !(error instanceof ApiResponseError) || (error.code === undefined && (error.status >= 502 || error.status === 408));
