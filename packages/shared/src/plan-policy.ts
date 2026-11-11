/**
 * The one effective-plan resolver and capability evaluator. Settings, publish,
 * public delivery, the worker, MCP and the usage/entitlement endpoints all
 * decide through these two functions, so they can never disagree.
 *
 * Pure: callers load the organization's assignment and the canonical default
 * plan (`DEFAULT_PLAN_KEY`) from the database with whatever columns they need.
 */

/** The plan an organization falls back to without an active assignment. */
export const DEFAULT_PLAN_KEY = 'free';

export interface PlanEntitlementPolicy {
  capabilityKey: string;
  enabled: boolean;
  meter: { active: boolean } | null;
}

export interface PlanPolicy<E extends PlanEntitlementPolicy = PlanEntitlementPolicy> {
  key: string;
  active: boolean;
  entitlements: readonly E[];
}

export interface PlanAssignmentState<P extends PlanPolicy = PlanPolicy> {
  status: string;
  effectiveAt: Date | string;
  expiresAt: Date | string | null;
  plan: P;
}

/** Why the organization's own assignment does not apply. */
export type AssignmentState = 'active' | 'missing' | 'inactive';

export type EffectivePlan<P extends PlanPolicy = PlanPolicy> =
  | { source: 'assignment'; assignment: 'active'; plan: P }
  | { source: 'default'; assignment: 'missing' | 'inactive'; plan: P }
  | { source: 'none'; assignment: 'missing' | 'inactive'; plan: null };

const instant = (value: Date | string): number | null => {
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
};

/** An assignment applies only while active, effective and unexpired, on an active plan. */
export const assignmentIsActive = (assignment: PlanAssignmentState | null | undefined, now = new Date()): boolean => {
  if (assignment?.status !== 'active' || !assignment.plan.active) return false;
  const effectiveAt = instant(assignment.effectiveAt);
  if (effectiveAt === null || effectiveAt > now.getTime()) return false;
  if (assignment.expiresAt === null) return true;
  const expiresAt = instant(assignment.expiresAt);
  return expiresAt !== null && expiresAt > now.getTime();
};

/**
 * The plan that governs an organization right now:
 * - its own assignment when active (paid or free);
 * - otherwise (missing, canceled, trial-status, expired, not yet effective, or
 *   an inactive plan) the canonical `free` plan as configured in the database,
 *   with its real entitlements, meters and active flag. Never another plan.
 * - If the free plan is absent or inactive: no plan, so no capability is
 *   granted at all (`source: 'none'`).
 */
export const resolveEffectivePlan = <P extends PlanPolicy>(
  assignment: PlanAssignmentState<P> | null | undefined,
  defaultPlan: P | null | undefined,
  now = new Date(),
): EffectivePlan<P> => {
  if (assignment && assignmentIsActive(assignment, now)) return { source: 'assignment', assignment: 'active', plan: assignment.plan };
  const state = assignment ? 'inactive' : 'missing';
  if (defaultPlan && defaultPlan.key === DEFAULT_PLAN_KEY && defaultPlan.active) return { source: 'default', assignment: state, plan: defaultPlan };
  return { source: 'none', assignment: state, plan: null };
};

export interface CapabilityDecision<E extends PlanEntitlementPolicy = PlanEntitlementPolicy> {
  /** `unavailable`: no governing plan, or the entitlement's meter is inactive. */
  availability: 'complete' | 'unavailable';
  decision: 'enabled' | 'disabled' | 'unknown';
  planKey: string | null;
  entitlement: E | null;
}

/**
 * Whether the effective plan grants a capability: an explicit entitlement row
 * decides (enabled; an inactive meter makes it unavailable); without a row, the
 * plan must be among the capability's eligible plans. `comingSoon` never grants.
 */
export const evaluateCapability = <P extends PlanPolicy>(
  effective: EffectivePlan<P>,
  input: { capabilityKey: string; eligiblePlanKeys: readonly string[]; comingSoon?: boolean },
): CapabilityDecision<P['entitlements'][number]> => {
  if (!effective.plan) return { availability: 'unavailable', decision: 'unknown', planKey: null, entitlement: null };
  const plan = effective.plan;
  const entitlement = plan.entitlements.find((item) => item.capabilityKey === input.capabilityKey) ?? null;
  if (entitlement?.meter && !entitlement.meter.active) return { availability: 'unavailable', decision: 'unknown', planKey: plan.key, entitlement };
  const granted = !input.comingSoon && (entitlement ? entitlement.enabled : input.eligiblePlanKeys.includes(plan.key));
  return { availability: 'complete', decision: granted ? 'enabled' : 'disabled', planKey: plan.key, entitlement };
};
