import type { QueryClient } from '@tanstack/react-query';

export interface SessionCache {
  userId?: string | null;
  generation: number;
  client?: QueryClient;
}
const sessions = new WeakMap<QueryClient, SessionCache>();

export function sessionOf(client: QueryClient): SessionCache {
  let session = sessions.get(client);
  if (!session) {
    session = { generation: 0 };
    sessions.set(client, session);
  }
  return session;
}

export const getSessionGeneration = (client: QueryClient): number => sessionOf(client).generation;
