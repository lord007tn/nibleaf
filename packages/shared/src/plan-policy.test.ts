import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAN_KEY, evaluateCapability, type PlanAssignmentState, type PlanPolicy, resolveEffectivePlan } from './plan-policy';

const now = new Date('2026-11-11T12:00:00.000Z');
const free = (overrides: Partial<PlanPolicy> = {}): PlanPolicy => ({ key: 'free', active: true, entitlements: [], ...overrides });
const paid: PlanPolicy = { key: 'enterprise', active: true, entitlements: [{ capabilityKey: 'addons.feedback', enabled: true, meter: null }] };
const assignment = (overrides: Partial<PlanAssignmentState> = {}): PlanAssignmentState => ({
  status: 'active',
  effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
  expiresAt: null,
  plan: paid,
  ...overrides,
});
const allPlans = { capabilityKey: 'addons.broken-links', eligiblePlanKeys: ['free', 'pro', 'team', 'enterprise', 'self-hosted'] };
const paidOnly = { capabilityKey: 'addons.feedback', eligiblePlanKeys: ['pro', 'team', 'enterprise'] };

describe('resolveEffectivePlan', () => {
  it('uses the active assignment, paid or free', () => {
    expect(resolveEffectivePlan(assignment(), free(), now)).toMatchObject({
      source: 'assignment',
      assignment: 'active',
      plan: { key: 'enterprise' },
    });
  });

  it.each([
    ['missing', null],
    ['expired', assignment({ expiresAt: new Date('2026-11-01T00:00:00.000Z') })],
    ['canceled', assignment({ status: 'canceled' })],
    ['trial status', assignment({ status: 'trialing' })],
    ['not yet effective', assignment({ effectiveAt: new Date('2026-12-01T00:00:00.000Z') })],
    ['inactive plan', assignment({ plan: { ...paid, active: false } })],
    ['unparseable dates', assignment({ effectiveAt: 'not a date' })],
  ])('falls back to the canonical free plan when the assignment is %s, never the assigned paid plan', (_label, state) => {
    const effective = resolveEffectivePlan(state, free(), now);
    expect(effective.source).toBe('default');
    expect(effective.plan?.key).toBe(DEFAULT_PLAN_KEY);
    expect(evaluateCapability(effective, paidOnly).decision).toBe('disabled');
  });

  it.each([
    ['absent', null],
    ['inactive', free({ active: false })],
    ['not the free plan', { ...paid }],
  ])('grants nothing when the default plan is %s', (_label, defaultPlan) => {
    const effective = resolveEffectivePlan(null, defaultPlan, now);
    expect(effective).toMatchObject({ source: 'none', plan: null });
    expect(evaluateCapability(effective, allPlans)).toMatchObject({ availability: 'unavailable', decision: 'unknown' });
  });
});

describe('evaluateCapability', () => {
  it('decides by eligibility when the plan has no entitlement row', () => {
    const effective = resolveEffectivePlan(null, free(), now);
    expect(evaluateCapability(effective, allPlans)).toMatchObject({ availability: 'complete', decision: 'enabled', planKey: 'free' });
    expect(evaluateCapability(effective, paidOnly)).toMatchObject({ availability: 'complete', decision: 'disabled' });
  });

  it('honours the free plan’s real policy: a disabled row turns it off, through the fallback too', () => {
    const policy = free({ entitlements: [{ capabilityKey: 'addons.broken-links', enabled: false, meter: null }] });
    const freeAssigned = resolveEffectivePlan(assignment({ plan: policy }), policy, now);
    const expiredPaid = resolveEffectivePlan(assignment({ expiresAt: new Date('2026-11-01T00:00:00.000Z') }), policy, now);
    expect(evaluateCapability(freeAssigned, allPlans).decision).toBe('disabled');
    expect(evaluateCapability(expiredPaid, allPlans).decision).toBe('disabled');
  });

  it('makes an entitlement with an inactive meter unavailable', () => {
    const policy = free({ entitlements: [{ capabilityKey: 'addons.broken-links', enabled: true, meter: { active: false } }] });
    expect(evaluateCapability(resolveEffectivePlan(null, policy, now), allPlans)).toMatchObject({ availability: 'unavailable', decision: 'unknown' });
  });

  it('never grants a coming-soon capability', () => {
    expect(evaluateCapability(resolveEffectivePlan(null, free(), now), { ...allPlans, comingSoon: true }).decision).toBe('disabled');
  });
});
