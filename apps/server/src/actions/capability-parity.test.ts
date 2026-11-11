import { addonDefinitions, projectAddonRowsForDelivery } from '@nibleaf/shared/addons';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Merge council on #447: settings / MCP (`resolveProjectCapability`), the
 * entitlement endpoints (`getProjectEntitlements`), and publish / public
 * delivery / the worker (`projectAddonRowsForDelivery`) must agree for every
 * assignment state and every state of the canonical free plan, because they
 * all decide through `@nibleaf/shared/plan-policy`.
 */
const mocks = vi.hoisted(() => ({
  assignment: null as unknown,
  defaultPlan: null as unknown,
  assertProjectAccess: vi.fn(),
}));

vi.mock('@nibleaf/clickhouse', () => ({
  keys: () => ({ ANALYTICS_MODE: 'disabled' }),
  queryUsageMeterTotals: vi.fn(),
  UsageHistoryUnavailableError: class extends Error {},
}));
vi.mock('@nibleaf/database', () => ({
  Prisma: { DbNull: Symbol('DbNull'), sql: (strings: TemplateStringsArray) => strings.join('?') },
  prisma: {
    project: { findUnique: vi.fn(async () => ({ id: 'project-a', organizationId: 'org-a', dataTenantId: 'org-a' })) },
    member: { findUnique: vi.fn(async () => ({ role: 'owner', orgRole: 'owner' })) },
    organizationUsagePlan: { findUnique: vi.fn(async () => mocks.assignment) },
    usagePlan: { findUnique: vi.fn(async () => mocks.defaultPlan) },
    organization: { findUnique: vi.fn(async () => ({ metadata: null })) },
  },
}));
vi.mock('./projects', () => ({ assertProjectAccess: mocks.assertProjectAccess, assertProjectInOrg: vi.fn() }));

import { getProjectEntitlements, resolveProjectCapability } from './usage';

const context = (scopes: string[]) =>
  ({ get: (key: string) => (key === 'apiKey' ? { id: 'key-1', projectId: 'project-a', scopes } : null) }) as never;
const plan = (key: string, entitlements: Array<Record<string, unknown>> = [], active = true) => ({ key, active, meters: [], entitlements });
const at = (iso: string) => new Date(iso);
const freeDefault = plan('free');
const freeBrokenLinksOff = plan('free', [{ capabilityKey: 'addons.broken-links', enabled: false, limit: null, behavior: 'observe', meter: null }]);
const freeInactiveMeter = plan('free', [
  { capabilityKey: 'addons.broken-links', enabled: true, limit: null, behavior: 'observe', meter: { key: 'build', active: false } },
]);
const paid = plan('enterprise', [{ capabilityKey: 'addons.feedback', enabled: true, limit: null, behavior: 'observe', meter: null }]);
const assignment = (planRow: unknown, overrides: Record<string, unknown> = {}) => ({
  status: 'active',
  effectiveAt: at('2026-01-01T00:00:00Z'),
  expiresAt: null,
  plan: planRow,
  ...overrides,
});

const ASSIGNMENTS: Array<[string, (defaultPlan: unknown) => unknown]> = [
  ['missing', () => null],
  ['active free', (defaultPlan) => (defaultPlan ? assignment(defaultPlan) : assignment(freeDefault))],
  ['active paid', () => assignment(paid)],
  ['expired paid', () => assignment(paid, { expiresAt: at('2026-02-01T00:00:00Z') })],
  ['canceled paid', () => assignment(paid, { status: 'canceled' })],
  ['trial-status paid', () => assignment(paid, { status: 'trialing' })],
  ['future paid', () => assignment(paid, { effectiveAt: at('2099-01-01T00:00:00Z') })],
  ['inactive paid plan', () => assignment({ ...paid, active: false })],
];
const DEFAULTS: Array<[string, unknown]> = [
  ['free (no rows)', freeDefault],
  ['free with broken-links off', freeBrokenLinksOff],
  ['free with an inactive meter', freeInactiveMeter],
  ['free inactive', { ...freeDefault, active: false }],
  ['free absent', null],
];

describe('every consumer decides capabilities the same way', () => {
  beforeEach(() => {
    mocks.assertProjectAccess.mockResolvedValue({ organizationId: 'org-a', role: 'owner', project: { dataTenantId: 'org-a' } });
  });

  for (const [assignmentLabel, makeAssignment] of ASSIGNMENTS)
    for (const [defaultLabel, defaultPlan] of DEFAULTS)
      it(`${assignmentLabel} assignment × ${defaultLabel}`, async () => {
        mocks.defaultPlan = defaultPlan;
        mocks.assignment = makeAssignment(defaultPlan);
        const delivery = projectAddonRowsForDelivery(
          addonDefinitions.map((definition) => ({ key: definition.id, enabled: true, config: definition.defaultConfig })),
          mocks.assignment as never,
          defaultPlan as never,
        );
        const entitlements = await getProjectEntitlements(context(['entitlements:read']), 'project-a');
        for (const definition of addonDefinitions) {
          const settings = await resolveProjectCapability(context(['addons:read']), 'project-a', {
            capabilityKey: definition.availability.entitlement,
            eligiblePlanKeys: definition.availability.plans,
          });
          const delivered = delivery.find((row) => row.key === definition.id)?.enabled;
          // Settings and MCP may only allow what delivery then runs, and vice versa.
          expect(delivered, `${definition.id}: delivery vs settings`).toBe(
            settings.decision === 'enabled' && (definition.availability.state as string) !== 'coming_soon',
          );
          // No governing plan anywhere means the endpoints say so too.
          if (settings.planKey === null) expect(entitlements.availability, definition.id).toBe('unavailable');
          else expect(entitlements.planKey, definition.id).toBe(settings.planKey);
        }
      });
});
