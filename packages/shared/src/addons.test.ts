import { describe, expect, it } from 'vitest';
import {
  addonAvailableForPlan,
  addonConfigSchemas,
  addonDefinitions,
  DEFAULT_ADDON_PLAN,
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

describe('delivery entitlement projection', () => {
  const assignment = (overrides: Record<string, unknown> = {}) => ({
    status: 'active',
    effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: null,
    plan: {
      key: 'pro',
      active: true,
      entitlements: [],
    },
    ...overrides,
  });
  const feedback = [{ key: 'feedback' as const, enabled: true, config: { placement: 'after-content', presentation: 'compact' } }];
  const now = new Date('2026-08-24T00:00:00.000Z');

  const enabledAddon = (rows: ReturnType<typeof projectAddonRowsForDelivery>, key: string) => rows.find((addon) => addon.key === key)?.enabled;
  const allOn = ['ci-checks', 'broken-links', 'feedback'].map((key) => ({ key, enabled: true, config: {} }));

  it('keeps add-ons offered on every plan when the organization has no plan assignment', () => {
    const rows = projectAddonRowsForDelivery(allOn, null, now);
    expect(enabledAddon(rows, 'ci-checks')).toBe(true);
    expect(enabledAddon(rows, 'broken-links')).toBe(true);
    expect(enabledAddon(rows, 'feedback')).toBe(true);
    expect(enabledAddon(projectAddonRowsForDelivery(allOn, undefined, now), 'broken-links')).toBe(true);
  });

  it('falls back to the free default, not the assigned paid plan, when the assignment is expired, inactive or not yet effective', () => {
    // A paid plan that would unlock everything if it were honoured.
    const paid = { key: 'enterprise', active: true, entitlements: [{ capabilityKey: 'addons.feedback', enabled: true, meter: null }] };
    for (const state of [
      assignment({ plan: paid, expiresAt: new Date('2026-08-23T00:00:00.000Z') }),
      assignment({ plan: { ...paid, active: false } }),
      assignment({ plan: paid, status: 'canceled' }),
      assignment({ plan: paid, effectiveAt: new Date('2026-09-01T00:00:00.000Z') }),
    ]) {
      const rows = projectAddonRowsForDelivery(allOn, state, now);
      expect(enabledAddon(rows, 'ci-checks')).toBe(true);
      expect(enabledAddon(rows, 'broken-links')).toBe(true);
    }
  });

  it('matches the settings resolver: no entitlement row means the plan eligibility decides', () => {
    // The seeded free plan has no entitlement rows at all.
    const free = assignment({ plan: { key: 'free', active: true, entitlements: [] } });
    expect(enabledAddon(projectAddonRowsForDelivery(allOn, free, now), 'broken-links')).toBe(true);
    expect(enabledAddon(projectAddonRowsForDelivery(feedback, assignment(), now), 'feedback')).toBe(true);
  });

  it('never grants a paid-only add-on through the free fallback', () => {
    const paidOnly = { state: 'available', plans: ['pro', 'team', 'enterprise'], entitlement: 'addons.feedback' } as const;
    expect(addonAvailableForPlan(paidOnly, DEFAULT_ADDON_PLAN)).toBe(false);
    expect(addonAvailableForPlan(paidOnly, { key: 'pro', active: true, entitlements: [] })).toBe(true);
    expect(addonAvailableForPlan({ ...paidOnly, state: 'coming_soon' }, { key: 'pro', active: true, entitlements: [] })).toBe(false);
  });

  it('keeps a user-disabled add-on off whatever the plan', () => {
    const rows = projectAddonRowsForDelivery([{ key: 'broken-links', enabled: false, config: {} }], null, now);
    expect(enabledAddon(rows, 'broken-links')).toBe(false);
  });

  it('suppresses disabled and unavailable entitlements without changing the stored preference', () => {
    const disabled = assignment({
      plan: {
        key: 'pro',
        active: true,
        entitlements: [{ capabilityKey: 'addons.feedback', enabled: false, meter: null }],
      },
    });
    const unavailable = assignment({
      plan: {
        key: 'pro',
        active: true,
        entitlements: [{ capabilityKey: 'addons.feedback', enabled: true, meter: { active: false } }],
      },
    });

    expect(projectAddonRowsForDelivery(feedback, disabled, now).find((addon) => addon.key === 'feedback')).toMatchObject({ enabled: false });
    expect(projectAddonRowsForDelivery(feedback, unavailable, now).find((addon) => addon.key === 'feedback')).toMatchObject({ enabled: false });
    expect(feedback[0]?.enabled).toBe(true);
  });

  it('keeps meter quantities and limits outside capability availability', () => {
    const entitled = assignment({
      plan: {
        key: 'pro',
        active: true,
        entitlements: [{ capabilityKey: 'addons.feedback', enabled: true, meter: { active: true }, limit: 0n, quantity: 10n }],
      },
    });

    expect(projectAddonRowsForDelivery(feedback, entitled, now).find((addon) => addon.key === 'feedback')).toMatchObject({ enabled: true });
  });
});

it('preserves the optional owner policy through durable add-on configuration and public projection', () => {
  const config = addonConfigSchemas['consent-banner'].parse({ privacyPolicyUrl: 'https://example.invalid/privacy' });
  const projected = projectConfigWithAddons({}, [{ key: 'consent-banner', enabled: true, config }]);
  expect(projected).toMatchObject({ addons: { consentBanner: { privacyPolicyUrl: 'https://example.invalid/privacy' } } });
  expect(addonConfigSchemas['consent-banner'].safeParse({ privacyPolicyUrl: 'javascript:alert(1)' }).success).toBe(false);
});
