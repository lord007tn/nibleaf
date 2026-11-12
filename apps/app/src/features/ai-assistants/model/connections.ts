/** The plain shapes this model reads; the API's key and connected-app rows fit them. */
export interface KeyLike {
  id: string;
  state: 'active' | 'expired' | 'revoked' | 'rotation_required';
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string; email: string } | null;
}
export interface AppLike {
  id: string;
  lastUsedAt: string | null;
  createdAt: string;
  connectedBy: { id: string; name: string; email: string };
}

export type KeyStatus = 'active' | 'expiringSoon' | 'expired' | 'revoked' | 'rotationRequired';

export type ConnectionRow<K extends KeyLike, A extends AppLike> =
  | { kind: 'key'; id: string; key: K; status: KeyStatus; daysLeft: number | null; ownerId: string | null }
  | { kind: 'app'; id: string; app: A; ownerId: string };

export type Person = { id: string; name: string };

/** Keys that expire within this many days say so, with Rotate next to it. */
const EXPIRING_SOON_DAYS = 7;
const DAY = 86_400_000;

export function keyStatus(key: KeyLike, now: number): { status: KeyStatus; daysLeft: number | null } {
  if (key.state === 'revoked') return { status: 'revoked', daysLeft: null };
  if (key.state === 'expired') return { status: 'expired', daysLeft: null };
  if (key.state === 'rotation_required') return { status: 'rotationRequired', daysLeft: null };
  if (!key.expiresAt) return { status: 'active', daysLeft: null };
  const left = Date.parse(key.expiresAt) - now;
  if (left <= 0) return { status: 'expired', daysLeft: null };
  const daysLeft = Math.ceil(left / DAY);
  return daysLeft <= EXPIRING_SOON_DAYS ? { status: 'expiringSoon', daysLeft } : { status: 'active', daysLeft };
}

const lastTouched = (row: { lastUsedAt: string | null; createdAt: string }) => Date.parse(row.lastUsedAt ?? row.createdAt);

/**
 * One list of everything that can reach this website on someone's behalf:
 * signed-in apps and personal keys. Live rows come first, most recently used
 * on top; expired, revoked and to-be-rotated keys go under Inactive, where
 * they can still be rotated or removed. `personId` narrows the list to one
 * person (the Admin filter).
 */
export function connectionRows<K extends KeyLike, A extends AppLike>(
  keys: readonly K[],
  apps: readonly A[],
  options: { now: number; personId?: string | null },
): { live: ConnectionRow<K, A>[]; inactive: ConnectionRow<K, A>[]; people: Person[] } {
  const rows: Array<ConnectionRow<K, A> & { touched: number }> = [
    ...apps.map((app) => ({ kind: 'app' as const, id: app.id, app, ownerId: app.connectedBy.id, touched: lastTouched(app) })),
    ...keys.map((key) => ({
      kind: 'key' as const,
      id: key.id,
      key,
      ownerId: key.createdBy?.id ?? null,
      ...keyStatus(key, options.now),
      touched: lastTouched(key),
    })),
  ];
  const people = new Map<string, string>();
  for (const app of apps) people.set(app.connectedBy.id, app.connectedBy.name.trim() || app.connectedBy.email);
  for (const key of keys) if (key.createdBy) people.set(key.createdBy.id, key.createdBy.name.trim() || key.createdBy.email);
  const visible = options.personId ? rows.filter((row) => row.ownerId === options.personId) : rows;
  const isLive = (row: ConnectionRow<K, A>) => row.kind === 'app' || row.status === 'active' || row.status === 'expiringSoon';
  const ordered = [...visible].sort((a, b) => b.touched - a.touched).map(({ touched: _touched, ...row }) => row as ConnectionRow<K, A>);
  return {
    live: ordered.filter(isLive),
    inactive: ordered.filter((row) => !isLive(row)),
    people: [...people].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
