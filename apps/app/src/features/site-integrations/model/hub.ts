import type { IntegrationCatalogEntry, IntegrationProviderId } from '@nibleaf/shared/integrations';
import type { IntegrationDetailId } from '@/features/site-settings/model/ids';

/**
 * Settings → Integrations as a hub of what a site owner connects
 * (operations/ux/ai-and-integrations.md §4.4), grouped by the job it does. The
 * server's catalog also lists the services the server itself runs on (search,
 * storage, email, visitor analytics, custom domains) and the AI providers.
 * None of those is the owner's to connect here, so the hub never draws them:
 * AI keys live on the AI answers page, which a pointer row links to.
 */
export type HubGroupId = 'sync' | 'analytics' | 'notifications' | 'automation';

const HUB_GROUPS: ReadonlyArray<{ id: HubGroupId; providers: readonly IntegrationProviderId[] }> = [
  { id: 'sync', providers: ['github', 'gitlab', 'public-git'] },
  { id: 'analytics', providers: ['google-analytics', 'plausible'] },
  { id: 'notifications', providers: ['slack', 'discord'] },
  { id: 'automation', providers: ['zapier'] },
];

/** What a card says under the name once something is connected. */
export type CardLine =
  | { kind: 'syncing'; repository: string; branch: string }
  | { kind: 'tracking'; id: string }
  | { kind: 'posts'; label: string | null };

/**
 * A card's state. Binary and plain: either a status (Connected, Paused, Not
 * working, Coming soon, Not sending yet) or one action (Set up, Connect).
 * Never "Available", "Not configured" or "Unavailable".
 */
export type CardState =
  | { kind: 'connected'; line: CardLine }
  | { kind: 'paused'; line: CardLine }
  | { kind: 'notWorking' }
  /** Nothing is set up yet; the card offers its one action. */
  | { kind: 'setUp'; action: 'setUp' | 'connect' }
  /** Delivers nothing yet (D1): visible, not connectable. */
  | { kind: 'comingSoon' }
  /** A connection stored before "coming soon": it can only be removed. */
  | { kind: 'notSendingYet'; line: CardLine };

/** Where a card leads: the Git page, an integration page inside the hub, or nowhere. */
type CardTarget = { kind: 'git' } | { kind: 'detail'; id: IntegrationDetailId } | null;

export interface HubCard {
  entry: IntegrationCatalogEntry;
  state: CardState;
  target: CardTarget;
}

const WEBHOOK_PROVIDERS = new Set<IntegrationProviderId>(['slack', 'discord', 'zapier']);
const LEGACY_GIT_PROVIDERS = new Set<IntegrationProviderId>(['gitlab', 'public-git']);

function lineOf(entry: IntegrationCatalogEntry): CardLine | null {
  const config = entry.connection?.config;
  switch (config?.providerId) {
    case 'github':
      return { kind: 'syncing', repository: config.repository, branch: config.baseBranch };
    case 'gitlab':
    case 'public-git':
      return { kind: 'syncing', repository: config.repository, branch: config.branch };
    case 'google-analytics':
      return { kind: 'tracking', id: config.measurementId };
    case 'plausible':
      return { kind: 'tracking', id: config.domain };
    case 'slack':
    case 'discord':
    case 'zapier':
      return { kind: 'posts', label: config.label };
    default:
      return null;
  }
}

/** One entry's card, or null when the hub doesn't draw it. */
export function hubCard(entry: IntegrationCatalogEntry): HubCard | null {
  const { connection } = entry;
  const line = lineOf(entry);
  if (WEBHOOK_PROVIDERS.has(entry.id)) {
    const id = entry.id as IntegrationDetailId;
    if (entry.availability === 'coming_soon') {
      return connection
        ? { entry, state: { kind: 'notSendingYet', line: line ?? { kind: 'posts', label: null } }, target: { kind: 'detail', id } }
        : { entry, state: { kind: 'comingSoon' }, target: null };
    }
    if (!connection) return { entry, state: { kind: 'setUp', action: 'connect' }, target: { kind: 'detail', id } };
    const posts = line ?? { kind: 'posts' as const, label: null };
    const state: CardState =
      connection.status === 'error'
        ? { kind: 'notWorking' }
        : connection.status === 'inactive'
          ? { kind: 'paused', line: posts }
          : { kind: 'connected', line: posts };
    return { entry, state, target: { kind: 'detail', id } };
  }
  if (entry.category === 'source_control') {
    // GitLab and plain Git URLs can only be kept, not newly connected: the Git page connects GitHub. Their
    // cards show while a site still syncs from one.
    if (LEGACY_GIT_PROVIDERS.has(entry.id) && !connection) return null;
    const state: CardState = !connection
      ? { kind: 'setUp', action: 'setUp' }
      : connection.status === 'error' || !line
        ? { kind: 'notWorking' }
        : { kind: 'connected', line };
    return { entry, state, target: { kind: 'git' } };
  }
  if (entry.id === 'google-analytics' || entry.id === 'plausible') {
    const state: CardState = connection && line ? { kind: 'connected', line } : { kind: 'setUp', action: 'setUp' };
    return { entry, state, target: { kind: 'detail', id: 'analytics' } };
  }
  // AI providers and the server's own services.
  return null;
}

/** The hub's groups in order, each with its cards; empty groups are dropped. */
export function hubGroups(entries: readonly IntegrationCatalogEntry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return HUB_GROUPS.map((group) => ({
    id: group.id,
    cards: group.providers.flatMap((id) => {
      const entry = byId.get(id);
      const card = entry ? hubCard(entry) : null;
      return card ? [card] : [];
    }),
  })).filter((group) => group.cards.length > 0);
}

/**
 * The webhook entry an `?integration=` link opens, or null when there is
 * nothing to show (unknown, or coming soon with nothing stored), so the link
 * falls back to the hub. Analytics needs no entry.
 */
export function detailEntry(entries: readonly IntegrationCatalogEntry[], id: Exclude<IntegrationDetailId, 'analytics'>) {
  const entry = entries.find((candidate) => candidate.id === id);
  const card = entry ? hubCard(entry) : null;
  return card?.target?.kind === 'detail' ? card.entry : null;
}
