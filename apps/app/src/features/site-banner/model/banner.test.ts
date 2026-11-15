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
  it('sends both toggles and the trimmed text', () => {
    expect(
      projectBannerPatch(values({ enabled: true, message: '  Hello  ', linkLabel: ' Shop ', linkUrl: ' https://acme.test/sale ' })),
    ).toStrictEqual({
      enabled: true,
      dismissible: true,
      message: 'Hello',
      linkLabel: 'Shop',
      linkUrl: 'https://acme.test/sale',
    });
  });

  // The server merges `config.banner` one level deep and keeps any key a patch
  // leaves out, so a cleared text must be sent as '' or the old text comes back.
  it.each(['message', 'linkLabel', 'linkUrl'] as const)('sends a cleared or blank %s as an empty string, never leaving it out', (key) => {
    for (const blank of ['', '   ', '\t\n ']) {
      const patch = projectBannerPatch({ ...projectBanner, [key]: blank });
      expect(Object.hasOwn(patch, key)).toBe(true);
      expect(patch).toStrictEqual({ ...projectBanner, [key]: '' });
      // JSON keeps the key, so the request carries it.
      expect(JSON.parse(JSON.stringify({ config: { banner: patch } })).config.banner[key]).toBe('');
    }
  });

  it('reads a cleared text back as empty, and a saved project patch round-trips', () => {
    const cleared = values({ enabled: true, dismissible: false, message: 'Spring sale', linkUrl: 'mailto:team@acme.test' });
    expect(projectBannerValues(projectBannerPatch(cleared))).toStrictEqual(cleared);
    expect(projectBannerValues(projectBannerPatch(values()))).toStrictEqual(values());
  });

  it('keeps nonblank absolute links as typed, trimmed', () => {
    for (const linkUrl of ['https://acme.test/sale', 'mailto:team@acme.test', 'tel:+123456789', 'ftp://acme.test/file']) {
      expect(projectBannerPatch(values({ linkUrl: ` ${linkUrl} ` })).linkUrl).toBe(linkUrl);
    }
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

  it('never stores a blank text: a cleared field inherits the project', () => {
    const override = languageBannerOverride(
      values({ enabled: true, dismissible: false, message: 'Soldes', linkLabel: '  ', linkUrl: '' }),
      projectBanner,
    );
    expect(override).toStrictEqual({ message: 'Soldes' });
    expect(languageBannerOverride(values({ enabled: true, dismissible: false, linkLabel: ' ' }), projectBanner)).toBeNull();
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
  it.each([
    '',
    '   ',
    'https://acme.test/sale',
    'http://acme.test',
    ' https://acme.test/docs/ar/guide?ref=banner#plans ',
    'https://acme.test:8443/pricing',
    'https://bücher.example/angebote',
    'https://xn--bcher-kva.example/',
    'HTTPS://ACME.TEST/SALE',
    'Http://acme.test',
    'mailto:team@acme.test',
    'MAILTO:team@acme.test',
    'tel:+123456789',
    'ftp://acme.test/file',
  ])('accepts %j: empty, or an absolute URL as native type="url" does', (value) => {
    expect(linkUrlProblem(value)).toBeUndefined();
  });

  it.each(['/guide', 'guide', './guide', '../pricing', '#plans', '?ref=banner', '//acme.test/sale', 'acme.test/pricing', 'https://'])(
    'rejects %j: relative and bare paths, and addresses that do not parse',
    (value) => {
      expect(linkUrlProblem(value)).toBe('invalid');
    },
  );

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<p>hi</p>',
    'VBScript:msgbox',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
  ])('rejects %j: a scheme the server refuses', (value) => {
    expect(linkUrlProblem(value)).toBe('invalid');
  });
});
