import { describe, expect, it } from 'vitest';
import {
  addonConfigSchemas,
  addonDefinitions,
  defaultProjectAddonProvisioning,
  legacyConsentBannerEnabled,
  parseAddonConfigRecord,
  projectAddonRowsForDelivery,
  projectConfigWithAddons,
} from './addons';

describe('default add-on provisioning', () => {
  it.each([
    ['project creation', 'creator-user'],
    ['admin invitation', 'admin-user'],
    ['Better Auth starter', 'member-user'],
  ])('keeps %s rows and configured audit events in parity', (_path, actorUserId) => {
    const provisioning = defaultProjectAddonProvisioning('project-a', actorUserId);

    expect(provisioning.addons).toHaveLength(addonDefinitions.length);
    expect(provisioning.auditEvents).toHaveLength(provisioning.addons.length);
    for (const addon of provisioning.addons) {
      expect(provisioning.auditEvents).toContainEqual({
        projectId: addon.projectId,
        addonKey: addon.key,
        actorUserId,
        actorApiKeyId: null,
        action: 'configured',
        previousEnabled: null,
        nextEnabled: addon.enabled,
        nextConfig: addon.config,
        revision: addon.revision,
      });
    }
  });
});

describe('legacy consent migration', () => {
  it('prefers a valid explicit consent add-on value', () => {
    expect(legacyConsentBannerEnabled({ addons: { consentBanner: { enabled: false } }, analytics: { cookieConsent: true } })).toBe(false);
  });

  it('preserves a valid legacy analytics value when the explicit value is absent', () => {
    expect(legacyConsentBannerEnabled({ analytics: { cookieConsent: false } })).toBe(false);
    expect(legacyConsentBannerEnabled({ analytics: { cookieConsent: true } })).toBe(true);
    expect(legacyConsentBannerEnabled({ addons: { consentBanner: { enabled: 'invalid' } }, analytics: { cookieConsent: false } })).toBe(false);
  });

  it('uses the safe default for malformed and missing values', () => {
    expect(legacyConsentBannerEnabled({ addons: { consentBanner: { enabled: 'yes' } }, analytics: { cookieConsent: 1 } })).toBe(true);
    expect(legacyConsentBannerEnabled({})).toBe(true);
  });
});

describe('add-on configuration validation', () => {
  it('accepts bounded http(s) templates with known placeholders', () => {
    expect(addonConfigSchemas['edit-suggestions'].safeParse({ urlTemplate: 'https://github.com/acme/docs/edit/main/{path}' }).success).toBe(true);
    expect(addonConfigSchemas['issue-links'].safeParse({ urlTemplate: 'https://github.com/acme/docs/issues/new?url={url}' }).success).toBe(true);
  });

  it.each(['javascript:alert(1)', 'ftp://example.com/{path}', 'https://user:secret@example.com/{path}', 'https://example.com/{unknown}'])(
    'rejects unsafe or unknown edit URL template %s',
    (urlTemplate) => {
      expect(addonConfigSchemas['edit-suggestions'].safeParse({ urlTemplate }).success).toBe(false);
    },
  );

  it('rejects unmatched and nested braces in every URL-template add-on', () => {
    for (const addonId of ['edit-suggestions', 'issue-links'] as const) {
      for (const urlTemplate of ['https://example.com/{path', 'https://example.com/path}', 'https://example.com/{{path}}']) {
        expect(addonConfigSchemas[addonId].safeParse({ urlTemplate }).success).toBe(false);
      }
    }
  });
});

describe('Project.config compatibility projection', () => {
  it('replaces a malformed root with a bounded safe projection', () => {
    expect(projectConfigWithAddons('malformed', [])).toMatchObject({
      addons: { feedback: true, grammarLinter: false, consentBanner: { enabled: true } },
      analytics: { cookieConsent: true },
    });
  });

  it('preserves unrelated sibling sections while replacing owned add-on fields', () => {
    const projected = projectConfigWithAddons(
      {
        search: { mode: 'hybrid' },
        theme: { preset: 'signal' },
        analytics: { provider: 'plausible', cookieConsent: true },
        addons: { futureField: 'keep' },
      },
      [
        { key: 'feedback', enabled: false, config: { placement: 'after-navigation', presentation: 'card' } },
        {
          key: 'consent-banner',
          enabled: false,
          config: { placement: 'bottom-center', presentation: 'compact', buttonLayout: 'stacked' },
        },
      ],
    );

    expect(projected).toMatchObject({
      search: { mode: 'hybrid' },
      theme: { preset: 'signal' },
      analytics: { provider: 'plausible', cookieConsent: false },
      addons: {
        futureField: 'keep',
        feedback: false,
        feedbackPlacement: 'after-navigation',
        feedbackPresentation: 'card',
        consentBanner: {
          enabled: false,
          placement: 'bottom-center',
          presentation: 'compact',
          buttonLayout: 'stacked',
        },
      },
    });
  });

  it('omits absent URL-template fields from the durable JSON projection', () => {
    const projected = projectConfigWithAddons(
      { addons: { editUrl: 'https://stale.example/edit', issueUrl: 'https://stale.example/issue', futureField: 'keep' } },
      [
        { key: 'edit-suggestions', enabled: true, config: {} },
        { key: 'issue-links', enabled: true, config: {} },
      ],
    );
    const addons = parseAddonConfigRecord(projected.addons);

    expect(addons).not.toHaveProperty('editUrl');
    expect(addons).not.toHaveProperty('issueUrl');
    expect(addons).toMatchObject({ editSuggestions: true, issueLinks: true, futureField: 'keep' });
    expect(JSON.parse(JSON.stringify(projected))).toEqual(projected);
  });
});

describe('delivery entitlement projection (shared resolver)', () => {
  const now = new Date('2026-08-24T00:00:00.000Z');
  const free = { key: 'free', active: true, entitlements: [] as { capabilityKey: string; enabled: boolean; meter: { active: boolean } | null }[] };
  const assignment = (overrides: Record<string, unknown> = {}) => ({
    status: 'active',
    effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
    plan: { key: 'pro', active: true, entitlements: [] as { capabilityKey: string; enabled: boolean; meter: { active: boolean } | null }[] },
    ...overrides,
  });
  const allOn = ['ci-checks', 'broken-links', 'feedback'].map((key) => ({ key, enabled: true, config: {} }));
  const on = (rows: ReturnType<typeof projectAddonRowsForDelivery>, key: string) => rows.find((addon) => addon.key === key)?.enabled;

  it('keeps add-ons offered on every plan for an org without an assignment (the canonical free plan governs)', () => {
    const rows = projectAddonRowsForDelivery(allOn, null, free, now);
    expect(on(rows, 'ci-checks')).toBe(true);
    expect(on(rows, 'broken-links')).toBe(true);
    expect(on(rows, 'feedback')).toBe(true);
  });

  it('applies default-on add-ons when a project has no rows at all', () => {
    const rows = projectAddonRowsForDelivery([], null, free, now);
    for (const definition of addonDefinitions)
      expect(on(rows, definition.id)).toBe(definition.defaultEnabled && (definition.availability.state as string) !== 'coming_soon');
  });

  it('uses the free plan’s real configuration in the fallback: disabled there is disabled here', () => {
    const policy = { ...free, entitlements: [{ capabilityKey: 'addons.broken-links', enabled: false, meter: null }] };
    const expiredPaid = assignment({ plan: { key: 'enterprise', active: true, entitlements: [] }, expiresAt: new Date('2026-08-01T00:00:00.000Z') });
    expect(on(projectAddonRowsForDelivery(allOn, assignment({ plan: policy }), policy, now), 'broken-links')).toBe(false);
    expect(on(projectAddonRowsForDelivery(allOn, expiredPaid, policy, now), 'broken-links')).toBe(false);
    expect(on(projectAddonRowsForDelivery(allOn, null, { ...free, active: false }, now), 'broken-links')).toBe(false);
    expect(on(projectAddonRowsForDelivery(allOn, null, null, now), 'broken-links')).toBe(false);
  });

  it('suppresses disabled and unavailable entitlements without changing the stored preference', () => {
    const feedback = [{ key: 'feedback', enabled: true, config: {} }];
    const disabled = assignment({
      plan: { key: 'pro', active: true, entitlements: [{ capabilityKey: 'addons.feedback', enabled: false, meter: null }] },
    });
    const unavailable = assignment({
      plan: { key: 'pro', active: true, entitlements: [{ capabilityKey: 'addons.feedback', enabled: true, meter: { active: false } }] },
    });
    expect(on(projectAddonRowsForDelivery(feedback, disabled, free, now), 'feedback')).toBe(false);
    expect(on(projectAddonRowsForDelivery(feedback, unavailable, free, now), 'feedback')).toBe(false);
    expect(feedback[0]?.enabled).toBe(true);
  });

  it('keeps a user-disabled add-on off whatever the plan', () => {
    expect(on(projectAddonRowsForDelivery([{ key: 'broken-links', enabled: false, config: {} }], null, free, now), 'broken-links')).toBe(false);
  });
});
