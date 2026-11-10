import { ADDON_IDS, addonConfigSchemas } from '@nibleaf/shared/addons';
import { describe, expect, it } from 'vitest';
import {
  type AddonLike,
  addonBadges,
  addonGroups,
  addonSettingsKind,
  consentConfig,
  consentValues,
  feedbackConfig,
  feedbackValues,
  isUrlTemplateAddon,
  privacyUrlProblem,
  readOnlyNote,
  settingsDecision,
  toggleDecision,
  URL_TEMPLATE_PLACEHOLDERS,
  urlTemplateConfig,
  urlTemplateProblem,
  urlTemplateValues,
} from './addons';

const available = { state: 'available', available: true } as const;
const addon = (overrides: Partial<AddonLike> = {}): AddonLike => ({
  id: 'feedback',
  group: 'engagement',
  config: {},
  status: 'active',
  availability: available,
  ...overrides,
});

describe('addonGroups', () => {
  it('orders groups as the registry does and keeps the server order inside each', () => {
    const groups = addonGroups([
      addon({ id: 'ci-checks', group: 'publishing' }),
      addon({ id: 'consent-banner', group: 'privacy' }),
      addon({ id: 'issue-links', group: 'engagement' }),
      addon({ id: 'feedback', group: 'engagement' }),
    ]);
    expect(groups.map((group) => group.id)).toEqual(['engagement', 'privacy', 'publishing']);
    expect(groups[0]?.addons.map((item) => item.id)).toEqual(['issue-links', 'feedback']);
  });

  it('leaves out a group with no add-ons', () => {
    expect(addonGroups([addon()]).map((group) => group.id)).toEqual(['engagement']);
    expect(addonGroups([])).toEqual([]);
  });
});

describe('addonBadges', () => {
  it('shows no badge for plain on and off: the switch says that', () => {
    expect(addonBadges(addon({ status: 'active' }))).toEqual([]);
    expect(addonBadges(addon({ status: 'inactive' }))).toEqual([]);
  });

  it('flags previews, missing settings and add-ons the plan lacks', () => {
    expect(addonBadges(addon({ status: 'needs_configuration', availability: { state: 'preview', available: true } }))).toEqual([
      { tone: 'info', label: 'settings.addons.availability.preview' },
      { tone: 'warning', label: 'settings.addons.status.needsconfiguration' },
    ]);
    expect(addonBadges(addon({ status: 'unavailable', availability: { state: 'available', available: false } }))).toEqual([
      { tone: 'neutral', label: 'settings.addons.status.unavailable' },
    ]);
  });
});

describe('access', () => {
  it('lets Admins switch add-ons the plan includes', () => {
    expect(toggleDecision(addon(), 'admin', false)).toEqual({ kind: 'allowed' });
  });

  it('explains an add-on the plan does not include', () => {
    expect(toggleDecision(addon({ availability: { state: 'available', available: false } }), 'admin', false)).toEqual({
      kind: 'denied',
      reason: 'settings.addons.unavailableDescription',
    });
  });

  it('locks without a reason while access loads, for non-Admins, and while a switch saves', () => {
    expect(toggleDecision(addon(), 'pending', false)).toEqual({ kind: 'locked' });
    expect(toggleDecision(addon(), 'notAdmin', false)).toEqual({ kind: 'locked' });
    expect(toggleDecision(addon(), 'admin', true)).toEqual({ kind: 'locked' });
    // The plan reason is for Admins; others get the one note at the top.
    expect(toggleDecision(addon({ availability: { state: 'available', available: false } }), 'notAdmin', false)).toEqual({ kind: 'locked' });
  });

  it('opens settings to Admins only', () => {
    expect(settingsDecision('admin')).toEqual({ kind: 'allowed' });
    expect(settingsDecision('notAdmin')).toEqual({ kind: 'locked' });
    expect(settingsDecision('pending')).toEqual({ kind: 'locked' });
  });

  it('says once why the page is read-only, worded for Viewers when they are one', () => {
    expect(readOnlyNote('admin', 'edit')).toBeNull();
    expect(readOnlyNote('pending', 'pending')).toBeNull();
    expect(readOnlyNote('notAdmin', 'edit')).toBe('settings.permissions.body');
    expect(readOnlyNote('notAdmin', 'viewOnly')).toBe('settings.permissions.viewerBody');
  });
});

describe('addonSettingsKind', () => {
  it('gives the four configurable add-ons a form and the rest none', () => {
    expect(Object.fromEntries(ADDON_IDS.map((id) => [id, addonSettingsKind(id)]))).toEqual({
      feedback: 'feedback',
      'edit-suggestions': 'urlTemplate',
      'issue-links': 'urlTemplate',
      'consent-banner': 'consent',
      'ci-checks': null,
      'broken-links': null,
      'grammar-linter': null,
      'preview-deployments': null,
    });
    expect(ADDON_IDS.filter(isUrlTemplateAddon)).toEqual(['edit-suggestions', 'issue-links']);
  });
});

describe('form values', () => {
  it('reads feedback settings, falling back to the defaults for missing or unknown values', () => {
    expect(feedbackValues({ placement: 'after-navigation', presentation: 'card' })).toEqual({ placement: 'after-navigation', presentation: 'card' });
    expect(feedbackValues({ placement: 'sidebar' })).toEqual({ placement: 'after-content', presentation: 'compact' });
    expect(feedbackConfig({ placement: 'after-navigation', presentation: 'card' })).toEqual({ placement: 'after-navigation', presentation: 'card' });
  });

  it('trims a URL template and sends nothing when it is empty', () => {
    expect(urlTemplateValues({})).toEqual({ urlTemplate: '' });
    expect(urlTemplateValues({ urlTemplate: 42 })).toEqual({ urlTemplate: '' });
    expect(urlTemplateConfig({ urlTemplate: '  https://x.test/{path}  ' })).toEqual({ urlTemplate: 'https://x.test/{path}' });
    expect(urlTemplateConfig({ urlTemplate: '   ' })).toEqual({});
  });

  it('reads consent settings and leaves an empty privacy address out of the save', () => {
    expect(consentValues({})).toEqual({ placement: 'bottom-end', presentation: 'comfortable', buttonLayout: 'inline', privacyPolicyUrl: '' });
    const values = consentValues({
      placement: 'bottom-start',
      presentation: 'compact',
      buttonLayout: 'stacked',
      privacyPolicyUrl: 'https://a.test/p',
    });
    expect(consentConfig(values)).toEqual({
      placement: 'bottom-start',
      presentation: 'compact',
      buttonLayout: 'stacked',
      privacyPolicyUrl: 'https://a.test/p',
    });
    expect(consentConfig({ ...values, privacyPolicyUrl: '  ' })).not.toHaveProperty('privacyPolicyUrl');
    expect(consentConfig({ ...values, privacyPolicyUrl: ' https://a.test/p ' }).privacyPolicyUrl).toBe('https://a.test/p');
  });

  it('builds configs the server schema accepts', () => {
    expect(addonConfigSchemas.feedback.safeParse(feedbackConfig(feedbackValues({}))).success).toBe(true);
    expect(addonConfigSchemas['consent-banner'].safeParse(consentConfig(consentValues({}))).success).toBe(true);
    expect(addonConfigSchemas['issue-links'].safeParse(urlTemplateConfig({ urlTemplate: '' })).success).toBe(true);
  });
});

describe('address checks', () => {
  it('accepts an empty template and http(s) templates with the add-on’s placeholders', () => {
    expect(urlTemplateProblem('edit-suggestions', '')).toBeUndefined();
    expect(urlTemplateProblem('edit-suggestions', 'https://github.com/acme/docs/edit/main/{path}.mdx')).toBeUndefined();
    expect(urlTemplateProblem('issue-links', 'https://github.com/acme/docs/issues/new?body={url}')).toBeUndefined();
  });

  it('reports a placeholder the add-on does not fill', () => {
    expect(urlTemplateProblem('edit-suggestions', 'https://x.test/?u={url}')).toBe('unsupportedPlaceholder');
    expect(urlTemplateProblem('issue-links', 'https://x.test/{branch}')).toBe('unsupportedPlaceholder');
  });

  it('reports anything that is not an http(s) address without credentials', () => {
    expect(urlTemplateProblem('edit-suggestions', 'github.com/{path}')).toBe('invalid');
    expect(urlTemplateProblem('edit-suggestions', 'ftp://x.test/{path}')).toBe('invalid');
    expect(urlTemplateProblem('issue-links', 'https://user:secret@x.test/{url}')).toBe('invalid');
  });

  it('allows exactly the placeholders the server schema allows', () => {
    for (const [id, placeholders] of Object.entries(URL_TEMPLATE_PLACEHOLDERS) as Array<
      [keyof typeof URL_TEMPLATE_PLACEHOLDERS, readonly string[]]
    >) {
      for (const name of placeholders) {
        expect(addonConfigSchemas[id].safeParse({ urlTemplate: `https://x.test/{${name}}` }).success).toBe(true);
      }
      expect(addonConfigSchemas[id].safeParse({ urlTemplate: 'https://x.test/{other}' }).success).toBe(false);
    }
  });

  it('checks the privacy policy address', () => {
    expect(privacyUrlProblem('')).toBeUndefined();
    expect(privacyUrlProblem('https://acme.test/privacy')).toBeUndefined();
    expect(privacyUrlProblem('acme.test/privacy')).toBe('invalid');
    expect(privacyUrlProblem('javascript:alert(1)')).toBe('invalid');
  });
});
