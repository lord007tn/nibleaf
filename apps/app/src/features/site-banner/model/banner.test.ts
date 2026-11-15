import { describe, expect, it } from 'vitest';
import { reconcileServerChange } from '@/lib/forms/server-draft';
import {
  type BannerValues,
  inheritedPlaceholders,
  languageBannerOverride,
  languageBannerValues,
  linkUrlProblem,
  projectBannerPatch,
  projectBannerValues,
} from './banner';

const values = (overrides: Partial<BannerValues> = {}): BannerValues => ({
  enabled: false,
  dismissible: true,
  message: '',
  linkLabel: '',
  linkUrl: '',
  ...overrides,
});

const projectBanner = { enabled: true, dismissible: false, message: 'Spring sale', linkLabel: 'Shop', linkUrl: 'https://acme.test/sale' };

describe('projectBannerValues', () => {
  it('defaults to off and dismissible with empty text when the project has no banner', () => {
    expect(projectBannerValues(undefined)).toEqual(values());
    expect(projectBannerValues(null)).toEqual(values());
    expect(projectBannerValues({})).toEqual(values());
  });

  it('reads every stored field', () => {
    expect(projectBannerValues(projectBanner)).toEqual(projectBanner);
  });
});

describe('projectBannerPatch', () => {
  it('sends both toggles and the trimmed text, leaving empty text out', () => {
    expect(projectBannerPatch(values({ enabled: true, message: '  Hello  ', linkLabel: '   ', linkUrl: ' /pricing ' }))).toEqual({
      enabled: true,
      dismissible: true,
      message: 'Hello',
      linkLabel: undefined,
      linkUrl: '/pricing',
    });
  });

  it('keeps an explicit false for both toggles', () => {
    const patch = projectBannerPatch(values({ enabled: false, dismissible: false }));
    expect(patch.enabled).toBe(false);
    expect(patch.dismissible).toBe(false);
  });
});

describe('languageBannerValues', () => {
  it('seeds text from the override only, never from the project', () => {
    expect(languageBannerValues(undefined, projectBanner)).toMatchObject({ message: '', linkLabel: '', linkUrl: '' });
    expect(languageBannerValues({ message: 'Soldes' }, projectBanner)).toMatchObject({ message: 'Soldes', linkLabel: '', linkUrl: '' });
  });

  it("falls back to the project's effective toggles, then the defaults", () => {
    expect(languageBannerValues(null, projectBanner)).toMatchObject({ enabled: true, dismissible: false });
    expect(languageBannerValues(null, undefined)).toMatchObject({ enabled: false, dismissible: true });
    expect(languageBannerValues({ enabled: false }, projectBanner)).toMatchObject({ enabled: false, dismissible: false });
    expect(languageBannerValues({ dismissible: true }, {})).toMatchObject({ enabled: false, dismissible: true });
  });
});

describe('inheritedPlaceholders', () => {
  it("shows the project's nonempty text", () => {
    expect(inheritedPlaceholders(projectBanner)).toEqual({ message: 'Spring sale', linkLabel: 'Shop', linkUrl: 'https://acme.test/sale' });
    expect(inheritedPlaceholders({ message: '', linkLabel: 'Shop' })).toEqual({ linkLabel: 'Shop' });
    expect(inheritedPlaceholders(undefined)).toEqual({});
  });
});

describe('languageBannerOverride', () => {
  it('clears the override (null) when nothing differs from the project', () => {
    expect(languageBannerOverride(languageBannerValues(null, projectBanner), projectBanner)).toBeNull();
    expect(languageBannerOverride(values({ message: '   ' }), undefined)).toBeNull();
  });

  it('stores nonempty text, trimmed', () => {
    expect(
      languageBannerOverride(values({ enabled: true, dismissible: false, message: ' Soldes ', linkUrl: ' /fr/soldes ' }), projectBanner),
    ).toEqual({
      message: 'Soldes',
      linkUrl: '/fr/soldes',
    });
  });

  it('stores only the toggles that differ from what the language inherits', () => {
    expect(languageBannerOverride(values({ enabled: true, dismissible: true }), projectBanner)).toEqual({ dismissible: true });
    expect(languageBannerOverride(values({ enabled: true, dismissible: true }), undefined)).toEqual({ enabled: true });
  });

  it('keeps an explicit false that differs from the project', () => {
    expect(languageBannerOverride(values({ enabled: false, dismissible: false }), projectBanner)).toStrictEqual({ enabled: false });
  });

  it('round-trips: a stored override reads back as the values that produced it', () => {
    const draft = values({ enabled: false, dismissible: true, message: 'Soldes' });
    expect(languageBannerValues(languageBannerOverride(draft, projectBanner), projectBanner)).toEqual(draft);
  });
});

describe('scope values in the draft lifecycle', () => {
  it('a toggle-only change is a single field, so a refetch of the text keeps it', () => {
    const baseline = projectBannerValues(projectBanner);
    const current = { ...baseline, dismissible: true };
    const next = projectBannerValues({ ...projectBanner, message: 'Summer sale' });
    expect(reconcileServerChange({ baseline, current, next })).toEqual({
      baseline: next,
      current: { ...next, dismissible: true },
      conflicts: [],
    });
  });

  it("a project toggle change reaches a language scope's inherited toggle", () => {
    const baseline = languageBannerValues(null, projectBanner);
    const current = { ...baseline, message: 'Soldes' };
    const next = languageBannerValues(null, { ...projectBanner, enabled: false });
    expect(reconcileServerChange({ baseline, current, next }).current).toEqual({ ...current, enabled: false });
  });
});

describe('linkUrlProblem', () => {
  it.each(['', '   ', 'https://acme.test/sale', 'http://acme.test', ' https://acme.test/docs/ar/guide?ref=banner#plans '])(
    'accepts %j: empty, or an absolute http(s) address',
    (value) => {
      expect(linkUrlProblem(value)).toBeUndefined();
    },
  );

  it.each([
    '/guide',
    'guide',
    './guide',
    '../pricing',
    '#plans',
    '?ref=banner',
    '//acme.test/sale',
    'acme.test/pricing',
    'https://',
    'mailto:team@acme.test',
    'ftp://acme.test/file',
    'javascript:alert(1)',
  ])('rejects %j: relative and bare paths, and other schemes', (value) => {
    expect(linkUrlProblem(value)).toBe('invalid');
  });
});
