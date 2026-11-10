import type { AnalyticsRange } from '@nibleaf/validators';

/*
 * Organization and "me" query keys. Kept out of query-keys.ts on purpose: that
 * module ships with the public reader's first load, and these keys are only
 * used by the signed-in dashboard (see BUNDLE_BUDGET.md).
 */
export const organizationKeys = {
  /** The signed-in person: switcher, landing, invitations, personal preferences. */
  me: {
    switcher: () => ['me', 'switcher'] as const,
    invitations: () => ['me', 'invitations'] as const,
    preferences: () => ['me', 'preferences'] as const,
  },
  organizations: {
    all: () => ['organizations'] as const,
    bySlug: (slug: string) => ['organizations', 'by-slug', slug] as const,
    detail: (organizationId: string) => ['organizations', organizationId] as const,
    projects: (organizationId: string, view: 'list' | 'switcher') => ['organizations', organizationId, 'projects', view] as const,
    members: (organizationId: string) => ['organizations', organizationId, 'members'] as const,
    usage: (organizationId: string) => ['organizations', organizationId, 'usage'] as const,
    analytics: (organizationId: string, range: AnalyticsRange, timezone: string) =>
      ['organizations', organizationId, 'analytics', range, timezone] as const,
  },
} as const;
