import { describe, expect, it } from 'vitest';
import {
  addonConfigSchemas,
  addonDefinitions,
  defaultProjectAddonProvisioning,
  legacyConsentBannerEnabled,
  parseAddonConfigRecord,
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
