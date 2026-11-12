import { type AddonDeliveryPlanAssignment, projectAddonRowsForDelivery, projectConfigWithAddons } from '@nibleaf/shared/addons';
import { analyticsConsentPolicy } from '@nibleaf/shared/analytics-consent';
import { buildSnapshot, type SiteSnapshot } from '@nibleaf/shared/site';
import { projectConfigSchema } from '@nibleaf/validators';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  project: vi.fn(),
  deploymentHead: vi.fn(),
  deploymentSnapshot: vi.fn(),
  pages: vi.fn(),
  orgProjects: vi.fn(),
}));

vi.mock('@nibleaf/database', () => ({
  Prisma: { DbNull: null },
  // #447's shared resolver: the canonical free plan as configured in the DB.
  deliveryPlanSelect: {},
  loadDefaultDeliveryPlan: async () => ({ key: 'free', active: true, entitlements: [] }),
  prisma: {
    project: { findUnique: mocks.project, findFirst: mocks.project, findMany: mocks.orgProjects },
    page: { findMany: mocks.pages },
    deployment: { findFirst: mocks.deploymentHead, findUnique: mocks.deploymentSnapshot, count: vi.fn(async () => 1) },
  },
}));
vi.mock('@nibleaf/auth/tenant-erasure', () => ({
  eraseProjectOrganization: vi.fn(),
  TenantErasureProjectNotFoundError: class extends Error {},
  TenantUsageDeletionPendingError: class extends Error {},
}));
vi.mock('@nibleaf/bullmq', () => ({ createJob: vi.fn(), QueueNames: {} }));
vi.mock('@nibleaf/search', () => ({ searchDocs: vi.fn() }));
vi.mock('hono/context-storage', () => ({ getContext: () => ({ req: { raw: { headers: new Headers() } } }) }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/lib/access', () => ({ accessibleProjectIds: vi.fn(), resolveSiteAccess: vi.fn() }));
vi.mock('@/lib/ai-search/quota', () => ({ consumeAnswerQuota: vi.fn(), recordAnswerServed: vi.fn(async () => undefined) }));
vi.mock('@/lib/ai-search/runtime', () => ({ answerPublishedSearch: vi.fn(), answerSearchAvailable: vi.fn(), runPublishedSearch: vi.fn() }));
vi.mock('@/lib/search-cache', () => ({ getCachedIndex: vi.fn() }));
vi.mock('./analytics', () => ({ trackProjectEvent: vi.fn(), trackProjectEvents: vi.fn() }));
vi.mock('./notifications', () => ({ createNotificationsForOrgMembers: vi.fn() }));
vi.mock('./reader-access', () => ({ resolveViewerAccess: vi.fn(async () => ({ kind: 'public', allowedPageIds: null })) }));

import { getCurrentSnapshot } from './deployments';
import { getSite, invalidateOrganizationPublishedConfig, invalidatePublishedSiteConfig } from './sites';

const defaultPlan = { key: 'free', active: true, entitlements: [] };

const freePlan: AddonDeliveryPlanAssignment = {
  status: 'active',
  effectiveAt: new Date('2026-01-01T00:00:00Z'),
  expiresAt: null,
  plan: { key: 'free', active: true, entitlements: [] },
};

const project = () => ({
  id: 'reader-addon-parity',
  organizationId: 'org-parity',
  name: 'Docs',
  slug: 'docs',
  description: null,
  icon: null,
  // Both the stored config and older snapshots can contain the broken values.
  config: { addons: { feedback: false }, analytics: { cookieConsent: false }, redirects: [], visibility: 'public' },
  accessMode: 'PUBLIC' as const,
  readerAccessRequests: false,
  takedownAt: null,
  domains: [],
  addons: [] as { key: string; enabled: boolean; config: unknown }[],
  organization: { usagePlan: freePlan as AddonDeliveryPlanAssignment | null },
  languages: [{ code: 'en', label: 'English', direction: 'LTR' as const, isDefault: true, enabled: true, config: null, projectTranslations: [] }],
  branches: [{ id: 'main', name: 'main', isDefault: true }],
});

describe('reader add-on parity', () => {
  let live: ReturnType<typeof project>;
  let frozen: SiteSnapshot;

  beforeEach(() => {
    vi.clearAllMocks();
    live = project();
    frozen = buildSnapshot(live, [], '2026-01-01T00:00:00Z');
    frozen.project.config = {
      addons: { feedback: false, consentBanner: { enabled: false, placement: 'bottom-end', presentation: 'comfortable', buttonLayout: 'inline' } },
      analytics: { cookieConsent: false },
      redirects: [],
    };
    mocks.project.mockResolvedValue(live);
    mocks.pages.mockResolvedValue([]);
    mocks.deploymentHead.mockResolvedValue({ id: `deployment-${expect.getState().currentTestName}`, version: 1 });
    mocks.deploymentSnapshot.mockResolvedValue({ snapshot: frozen });
    invalidatePublishedSiteConfig(live.id);
  });

  /** What the dashboard's add-on settings decide for the same live rows and plan:
   *  #447's shared resolver (its own 40-case cross-consumer parity test pins
   *  settings == MCP == usage == worker == delivery). */
  const dashboardView = () =>
    projectConfigWithAddons(live.config, projectAddonRowsForDelivery(live.addons, live.organization.usagePlan, defaultPlan));

  /** Serves the NEXT publish too: snapshots keep stored config and the overlay
   *  projects live rows at serve time, so readers must see the same thing. */
  const servedAfterNextPublish = async () => {
    const nextPublish = await getCurrentSnapshot(live.id);
    mocks.deploymentHead.mockResolvedValue({ id: `next-${expect.getState().currentTestName}`, version: 2 });
    mocks.deploymentSnapshot.mockResolvedValue({ snapshot: nextPublish });
    invalidatePublishedSiteConfig(live.id);
    return (await getSite(live.id)).project.config;
  };

  it.each(['free', 'legacy'] as const)('serves registry defaults for a %s project with no add-on rows, without republishing', async (kind) => {
    if (kind === 'legacy') live.organization.usagePlan = null;
    const original = structuredClone(frozen);
    const published = await getSite(live.id);

    expect(published.project.config).toEqual(dashboardView());
    expect(published.project.config).toMatchObject({
      addons: { feedback: true, consentBanner: { enabled: true }, grammarLinter: false },
      analytics: { cookieConsent: true },
    });
    expect(projectConfigSchema.safeParse(published.project.config).success).toBe(true);
    expect(analyticsConsentPolicy(published.project.config)).toBe('required');
    expect(frozen).toEqual(original);
    expect(await servedAfterNextPublish()).toEqual(published.project.config);
  });

  it('honors explicit owner disables over enabled frozen or stored config', async () => {
    live.addons = [
      { key: 'feedback', enabled: false, config: {} },
      { key: 'consent-banner', enabled: false, config: {} },
    ];
    live.config = { ...live.config, addons: { feedback: true }, analytics: { cookieConsent: true } };
    frozen.project.config = { addons: { feedback: true }, analytics: { cookieConsent: true }, redirects: [] };
    const published = await getSite(live.id);

    expect(published.project.config).toEqual(dashboardView());
    expect(published.project.config).toMatchObject({
      addons: { feedback: false, consentBanner: { enabled: false } },
      analytics: { cookieConsent: false },
    });
    expect(analyticsConsentPolicy(published.project.config)).toBe('not_required');
    expect(await servedAfterNextPublish()).toEqual(published.project.config);
  });

  it('applies explicit capability restrictions consistently to dashboard and readers', async () => {
    live.organization.usagePlan = {
      ...freePlan,
      plan: { ...freePlan.plan, entitlements: [{ capabilityKey: 'addons.feedback', enabled: false, meter: null }] },
    };
    const published = await getSite(live.id);

    expect(published.project.config).toEqual(dashboardView());
    expect(published.project.config).toMatchObject({
      addons: { feedback: false, consentBanner: { enabled: true } },
      analytics: { cookieConsent: true },
    });
    expect(await servedAfterNextPublish()).toEqual(published.project.config);
  });

  it('a plan or entitlement write reaches readers of every website in the organization at once', async () => {
    // Like a real DB read, the cached live row is a copy, not the object this test mutates.
    mocks.project.mockImplementation(async () => structuredClone(live));
    const before = await getSite(live.id);
    expect(before.project.config).toMatchObject({ addons: { feedback: true } });

    // The org's plan changes (an assignment or entitlement write)...
    live.organization.usagePlan = {
      ...freePlan,
      plan: { ...freePlan.plan, entitlements: [{ capabilityKey: 'addons.feedback', enabled: false, meter: null }] },
    };
    // ...while the 15 s live-chrome cache still holds the old projection.
    expect((await getSite(live.id)).project.config).toMatchObject({ addons: { feedback: true } });

    mocks.orgProjects.mockResolvedValue([{ id: live.id }, { id: 'sibling-site' }]);
    await expect(invalidateOrganizationPublishedConfig(live.organizationId)).resolves.toBe(2);
    expect(mocks.orgProjects).toHaveBeenCalledWith({ where: { organizationId: live.organizationId }, select: { id: true } });
    expect((await getSite(live.id)).project.config).toMatchObject({ addons: { feedback: false } });
  });

  it('never fails the write that triggered it when invalidation itself fails', async () => {
    mocks.orgProjects.mockRejectedValue(new Error('database unavailable'));
    await expect(invalidateOrganizationPublishedConfig(live.organizationId)).resolves.toBe(0);
  });
});
