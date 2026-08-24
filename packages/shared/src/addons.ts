import { z } from 'zod';

export const ADDON_GROUPS = ['engagement', 'privacy', 'publishing'] as const;
export type AddonGroup = 'engagement' | 'privacy' | 'publishing';

export const ADDON_IDS = [
  'feedback',
  'edit-suggestions',
  'issue-links',
  'consent-banner',
  'ci-checks',
  'broken-links',
  'grammar-linter',
  'preview-deployments',
] as const;
export type AddonId =
  | 'feedback'
  | 'edit-suggestions'
  | 'issue-links'
  | 'consent-banner'
  | 'ci-checks'
  | 'broken-links'
  | 'grammar-linter'
  | 'preview-deployments';

export const addonIdSchema = z.enum(ADDON_IDS);

export type AddonAuditAction = 'configured' | 'activated' | 'deactivated';
export const addonAuditActionSchema = z.enum(['configured', 'activated', 'deactivated']);

export type AddonAvailabilityState = 'available' | 'preview' | 'coming_soon';

export interface AddonConfigById {
  feedback: { placement: 'after-content' | 'after-navigation'; presentation: 'compact' | 'card' };
  'edit-suggestions': { urlTemplate?: string };
  'issue-links': { urlTemplate?: string };
  'consent-banner': {
    placement: 'bottom-start' | 'bottom-center' | 'bottom-end';
    presentation: 'compact' | 'comfortable';
    buttonLayout: 'inline' | 'stacked';
  };
  'ci-checks': Record<never, never>;
  'broken-links': Record<never, never>;
  'grammar-linter': Record<never, never>;
  'preview-deployments': Record<never, never>;
}

export interface AddonDefinition<Id extends AddonId = AddonId> {
  id: Id;
  group: AddonGroup;
  defaultEnabled: boolean;
  defaultConfig: AddonConfigById[Id];
  availability: {
    state: AddonAvailabilityState;
    plans: readonly string[];
    entitlement: `addons.${Id}`;
  };
  requiresConfiguration: boolean;
}

const ALL_PLANS = ['free', 'pro', 'team', 'enterprise', 'self-hosted'] as const;

const urlTemplateSchema = (allowedPlaceholders: readonly string[]) =>
  z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => {
      const substituted = value
        .replaceAll('{path}', 'page')
        .replaceAll('{encodedPath}', 'page')
        .replaceAll('{url}', 'https%3A%2F%2Fdocs.example.com');
      if (/[{}]/.test(substituted)) return false;
      try {
        const parsed = new URL(substituted);
        return ['http:', 'https:'].includes(parsed.protocol) && !(parsed.username || parsed.password);
      } catch {
        return false;
      }
    }, 'URL template must be an http(s) URL without embedded credentials.')
    .refine(
      (value) => [...value.matchAll(/\{([^{}]+)\}/g)].every((match) => allowedPlaceholders.includes(match[1] ?? '')),
      'URL template contains an unsupported placeholder.',
    );

const emptyConfigSchema = z.object({}).strict();

export const addonConfigSchemas = {
  feedback: z
    .object({
      placement: z.enum(['after-content', 'after-navigation']).default('after-content'),
      presentation: z.enum(['compact', 'card']).default('compact'),
    })
    .strict(),
  'edit-suggestions': z.object({ urlTemplate: urlTemplateSchema(['path', 'encodedPath']).optional() }).strict(),
  'issue-links': z.object({ urlTemplate: urlTemplateSchema(['url', 'path', 'encodedPath']).optional() }).strict(),
  'consent-banner': z
    .object({
      placement: z.enum(['bottom-start', 'bottom-center', 'bottom-end']).default('bottom-end'),
      presentation: z.enum(['compact', 'comfortable']).default('comfortable'),
      buttonLayout: z.enum(['inline', 'stacked']).default('inline'),
    })
    .strict(),
  'ci-checks': emptyConfigSchema,
  'broken-links': emptyConfigSchema,
  'grammar-linter': emptyConfigSchema,
  'preview-deployments': emptyConfigSchema,
} as const satisfies { [Id in AddonId]: z.ZodType<AddonConfigById[Id]> };

export const parseAddonConfig = <Id extends AddonId>(addonId: Id, config: unknown): AddonConfigById[Id] =>
  addonConfigSchemas[addonId].parse(config) as AddonConfigById[Id];

export const normalizeAddonConfig = <Id extends AddonId>(addonId: Id, config: unknown): AddonConfigById[Id] => {
  const parsed = addonConfigSchemas[addonId].safeParse(config);
  return (parsed.success ? parsed.data : ADDON_REGISTRY[addonId].defaultConfig) as AddonConfigById[Id];
};

export const ADDON_REGISTRY = {
  feedback: {
    id: 'feedback',
    group: 'engagement',
    defaultEnabled: true,
    defaultConfig: { placement: 'after-content', presentation: 'compact' },
    availability: { state: 'available', plans: ALL_PLANS, entitlement: 'addons.feedback' },
    requiresConfiguration: false,
  },
  'edit-suggestions': {
    id: 'edit-suggestions',
    group: 'engagement',
    defaultEnabled: true,
    defaultConfig: {},
    availability: { state: 'available', plans: ALL_PLANS, entitlement: 'addons.edit-suggestions' },
    requiresConfiguration: true,
  },
  'issue-links': {
    id: 'issue-links',
    group: 'engagement',
    defaultEnabled: true,
    defaultConfig: {},
    availability: { state: 'available', plans: ALL_PLANS, entitlement: 'addons.issue-links' },
    requiresConfiguration: true,
  },
  'consent-banner': {
    id: 'consent-banner',
    group: 'privacy',
    defaultEnabled: true,
    defaultConfig: { placement: 'bottom-end', presentation: 'comfortable', buttonLayout: 'inline' },
    availability: { state: 'available', plans: ALL_PLANS, entitlement: 'addons.consent-banner' },
    requiresConfiguration: false,
  },
  'ci-checks': {
    id: 'ci-checks',
    group: 'publishing',
    defaultEnabled: true,
    defaultConfig: {},
    availability: { state: 'available', plans: ALL_PLANS, entitlement: 'addons.ci-checks' },
    requiresConfiguration: false,
  },
  'broken-links': {
    id: 'broken-links',
    group: 'publishing',
    defaultEnabled: true,
    defaultConfig: {},
    availability: { state: 'available', plans: ALL_PLANS, entitlement: 'addons.broken-links' },
    requiresConfiguration: false,
  },
  'grammar-linter': {
    id: 'grammar-linter',
    group: 'publishing',
    defaultEnabled: false,
    defaultConfig: {},
    availability: { state: 'preview', plans: ALL_PLANS, entitlement: 'addons.grammar-linter' },
    requiresConfiguration: false,
  },
  'preview-deployments': {
    id: 'preview-deployments',
    group: 'publishing',
    defaultEnabled: true,
    defaultConfig: {},
    availability: { state: 'available', plans: ALL_PLANS, entitlement: 'addons.preview-deployments' },
    requiresConfiguration: false,
  },
} as const satisfies { [Id in AddonId]: AddonDefinition<Id> };

export const addonDefinitions = ADDON_IDS.map((id) => ADDON_REGISTRY[id]);

/** Keep default durable rows and their initial audit trail derived from the
 * same registry snapshot so every provisioning path records identical state. */
export const defaultProjectAddonProvisioning = (projectId: string, actorUserId: string) => {
  const addons = addonDefinitions.map((definition) => ({
    projectId,
    key: definition.id,
    enabled: definition.defaultEnabled,
    config: definition.defaultConfig,
    revision: 1,
  }));
  return {
    addons,
    auditEvents: addons.map((addon) => ({
      projectId,
      addonKey: addon.key,
      actorUserId,
      actorApiKeyId: null,
      action: 'configured',
      previousEnabled: null,
      nextEnabled: addon.enabled,
      nextConfig: addon.config,
      revision: addon.revision,
    })),
  };
};

export const isAddonId = (value: string): value is AddonId => ADDON_IDS.some((id) => id === value);

export interface ProjectAddonProjectionRow {
  key: AddonId;
  enabled: boolean;
  config: unknown;
}

export interface AddonDeliveryPlanAssignment {
  status: string;
  effectiveAt: Date | string;
  expiresAt: Date | string | null;
  plan: {
    key: string;
    active: boolean;
    entitlements: readonly {
      capabilityKey: string;
      enabled: boolean;
      meter: { active: boolean } | null;
    }[];
  };
}

const validInstant = (value: Date | string): number | null => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

/** Resolve the add-ons that may reach public delivery or publish execution.
 * Durable enabled state remains the user's preference, while the current plan
 * and capability state are a separate fail-closed gate. Meter quantities and
 * limits are intentionally absent: usage enforcement is advisory. */
export const projectAddonRowsForDelivery = (
  rows: readonly { key: string; enabled: boolean; config: unknown }[],
  assignment: AddonDeliveryPlanAssignment | null | undefined,
  now = new Date(),
): ProjectAddonProjectionRow[] => {
  const byId = new Map(rows.flatMap((row) => (isAddonId(row.key) ? [[row.key, row] as const] : [])));
  const nowAt = now.getTime();
  const effectiveAt = assignment ? validInstant(assignment.effectiveAt) : null;
  const expiresAt = assignment?.expiresAt ? validInstant(assignment.expiresAt) : null;
  const activePlan =
    assignment?.status === 'active' &&
    assignment.plan.active &&
    effectiveAt !== null &&
    effectiveAt <= nowAt &&
    (assignment.expiresAt === null || (expiresAt !== null && expiresAt > nowAt));

  return addonDefinitions.map((definition) => {
    const row = byId.get(definition.id);
    const availability: AddonDefinition['availability'] = definition.availability;
    const entitlement = assignment?.plan.entitlements.find((item) => item.capabilityKey === definition.availability.entitlement);
    const capabilityAvailable =
      activePlan &&
      availability.state !== 'coming_soon' &&
      availability.plans.some((planKey) => planKey === assignment.plan.key) &&
      entitlement?.enabled === true &&
      (entitlement.meter?.active ?? true);
    return {
      key: definition.id,
      enabled: (row?.enabled ?? definition.defaultEnabled) && capabilityAvailable,
      config: row?.config ?? definition.defaultConfig,
    };
  });
};

export const addonConfigRecordSchema = z.record(z.string(), z.unknown());

export const parseAddonConfigRecord = (value: unknown): Record<string, unknown> => {
  const parsed = addonConfigRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
};

/** Preserve recognized legacy consent behavior during row backfill. The
 * explicit add-on value wins, then the old analytics flag, then the safe
 * privacy-preserving default. Each value is validated independently so one
 * malformed sibling cannot hide another recognized value. */
export const legacyConsentBannerEnabled = (value: unknown): boolean => {
  const root = parseAddonConfigRecord(value);
  const addons = parseAddonConfigRecord(root.addons);
  const consent = parseAddonConfigRecord(addons.consentBanner);
  const explicit = z.boolean().safeParse(consent.enabled);
  if (explicit.success) return explicit.data;
  const analytics = parseAddonConfigRecord(root.analytics);
  const previous = z.boolean().safeParse(analytics.cookieConsent);
  return previous.success ? previous.data : ADDON_REGISTRY['consent-banner'].defaultEnabled;
};

const rowById = (rows: readonly ProjectAddonProjectionRow[]) => new Map(rows.map((row) => [row.key, row]));

/**
 * Produce the backwards-compatible public Project.config add-on projection.
 * Durable ProjectAddon rows are authoritative; unrelated top-level config is
 * preserved so themes, search, analytics providers, and Git-native ownership do
 * not become part of the add-on domain.
 */
export const projectConfigWithAddons = (rawConfig: unknown, rows: readonly ProjectAddonProjectionRow[]): Record<string, unknown> => {
  const current = parseAddonConfigRecord(rawConfig);
  const currentAddons = parseAddonConfigRecord(current.addons);
  const preservedAddons = { ...currentAddons };
  delete preservedAddons.editUrl;
  delete preservedAddons.issueUrl;
  const currentAnalytics = parseAddonConfigRecord(current.analytics);
  const byId = rowById(rows);
  const state = <Id extends AddonId>(id: Id) => {
    const row = byId.get(id);
    return {
      enabled: row?.enabled ?? ADDON_REGISTRY[id].defaultEnabled,
      config: normalizeAddonConfig(id, row?.config ?? ADDON_REGISTRY[id].defaultConfig),
    };
  };
  const feedback = state('feedback');
  const editSuggestions = state('edit-suggestions');
  const issueLinks = state('issue-links');
  const consent = state('consent-banner');
  const ciChecks = state('ci-checks');
  const brokenLinks = state('broken-links');
  const grammarLinter = state('grammar-linter');
  const previewDeployments = state('preview-deployments');

  return {
    ...current,
    addons: {
      ...preservedAddons,
      feedback: feedback.enabled,
      feedbackPlacement: feedback.config.placement,
      feedbackPresentation: feedback.config.presentation,
      editSuggestions: editSuggestions.enabled,
      ...(editSuggestions.config.urlTemplate ? { editUrl: editSuggestions.config.urlTemplate } : {}),
      issueLinks: issueLinks.enabled,
      ...(issueLinks.config.urlTemplate ? { issueUrl: issueLinks.config.urlTemplate } : {}),
      consentBanner: { enabled: consent.enabled, ...consent.config },
      ciChecks: ciChecks.enabled,
      brokenLinks: brokenLinks.enabled,
      grammarLinter: grammarLinter.enabled,
      previewDeployments: previewDeployments.enabled,
    },
    analytics: { ...currentAnalytics, cookieConsent: consent.enabled },
  };
};
