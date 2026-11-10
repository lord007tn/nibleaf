import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';

/**
 * Organization metadata is returned to every member by the organization
 * endpoints, so it must never hold server-only material. The Git webhook secret
 * lives in its own server-only table. These helpers keep an organization update
 * from writing a copy back into metadata, and remove any copy still stored
 * there from every organization response, whatever its shape and whether or
 * not the API has cleaned that row up yet.
 */

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/** Metadata without server-only fields. Returns the input when nothing changes. */
export const withoutServerOnlyMetadata = <T>(metadata: T): T => {
  if (!(isRecord(metadata) && isRecord(metadata.git) && 'webhookSecret' in metadata.git)) return metadata;
  const { webhookSecret: _serverOnly, ...git } = metadata.git;
  return { ...metadata, git } as T;
};

/** An http(s) URL without credentials, query or fragment; null when it can't be parsed. */
export const withoutUrlCredentials = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

/** Organization responses expose only org-owned keys. Website metadata and
 * unclassified legacy keys stay in server-only ProjectLegacySettings. */
export const withoutMemberHiddenMetadata = <T>(metadata: T): T => {
  if (metadata == null) return metadata;
  if (!isRecord(metadata)) return {} as T;
  const allowed = ['plan', 'notifications', 'entitlements'];
  if (Object.keys(metadata).every((key) => allowed.includes(key))) return metadata;
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => allowed.includes(key))) as T;
};

/**
 * A `metadata` value as an endpoint returns it: parsed, or the stored JSON
 * text. Text that cannot be parsed is withheld, since it cannot be checked.
 */
const redactMetadataValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return withoutMemberHiddenMetadata(value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  const redacted = withoutMemberHiddenMetadata(parsed);
  return redacted === parsed ? value : JSON.stringify(redacted);
};

const MAX_DEPTH = 8;

/**
 * Remove server-only fields from every `metadata` value in an endpoint result
 * (an organization, a list of them, or a payload that nests them). Returns the
 * input when nothing changes; never mutates it.
 */
export const redactOrganizationPayload = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const next = redactOrganizationPayload(item, depth + 1);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? items : value;
  }
  if (!isPlainObject(value)) return value;
  let copy: Record<string, unknown> | null = null;
  for (const [key, child] of Object.entries(value)) {
    const next = key === 'metadata' ? redactMetadataValue(child) : redactOrganizationPayload(child, depth + 1);
    if (next !== child) {
      copy ??= { ...value };
      copy[key] = next;
    }
  }
  return copy ?? value;
};

/** `beforeUpdateOrganization` hook: drop server-only fields from incoming metadata. */
export const stripServerOnlyOrganizationMetadata = async ({
  organization,
}: {
  organization: { metadata?: Record<string, unknown> };
}): Promise<{ data: { metadata: Record<string, unknown> } } | undefined> => {
  if (organization.metadata === undefined) return;
  const metadata = withoutServerOnlyMetadata(organization.metadata);
  if (metadata === organization.metadata) return;
  return { data: { metadata } };
};

/** Filters the result of every organization endpoint through redactOrganizationPayload. */
export const organizationMetadataResponseFilter = () =>
  ({
    id: 'nibleaf-organization-metadata',
    hooks: {
      after: [
        {
          matcher: (context) => context.path?.startsWith('/organization') ?? false,
          handler: createAuthMiddleware(async (context) => {
            const returned = context.context.returned;
            const redacted = redactOrganizationPayload(returned);
            if (redacted !== returned) context.context.returned = redacted;
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
