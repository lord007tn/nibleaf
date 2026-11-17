import { updateLanguageBody, updateProjectBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { type FooterValues, footerValues, languageFooterConfig, languageFooterValues, projectFooterPatch, sentFooterValues } from './footer';

const STORED = { copyright: '© Acme', github: 'https://github.com/acme', x: 'https://x.com/acme', linkedin: '/company', madeWithBadge: false };
const values = (overrides: Partial<FooterValues> = {}): FooterValues => ({ ...footerValues(STORED), ...overrides });
/** The request body as the route's validator reads it after JSON (which drops `undefined`). */
const onTheWire = (footer: unknown) => updateProjectBody.parse(JSON.parse(JSON.stringify({ config: { footer } }))).config?.footer;

describe('footerValues', () => {
  it('reads unset text as blank and an unset badge as shown; an explicit false stays off', () => {
    expect(footerValues(undefined)).toStrictEqual({ copyright: '', github: '', x: '', linkedin: '', madeWithBadge: true });
    expect(footerValues({ madeWithBadge: false }).madeWithBadge).toBe(false);
    expect(footerValues({ madeWithBadge: true }).madeWithBadge).toBe(true);
  });

  it("a language scope edits its own copyright beside the project's global fields", () => {
    expect(languageFooterValues({ copyright: '© أكمي' }, STORED)).toStrictEqual({ ...footerValues(STORED), copyright: '© أكمي' });
    expect(languageFooterValues(null, STORED).copyright).toBe('');
  });
});

describe('projectFooterPatch: only what changed', () => {
  const BASE = footerValues(STORED);

  it('sends nothing for an untouched draft, and only the changed keys otherwise, trimmed', () => {
    expect(projectFooterPatch(BASE, BASE)).toStrictEqual({});
    expect(projectFooterPatch(values({ copyright: '  © Acme 2026 ' }), BASE)).toStrictEqual({ copyright: '© Acme 2026' });
  });

  it.each(['copyright', 'github', 'x', 'linkedin'] as const)('a cleared %s is sent as "" alone and survives the validator', (key) => {
    const patch = projectFooterPatch(values({ [key]: '   ' }), BASE);
    expect(patch).toStrictEqual({ [key]: '' });
    expect(onTheWire(patch)).toStrictEqual({ [key]: '' });
  });

  it('clears all four texts at once without sending the badge it left alone', () => {
    expect(onTheWire(projectFooterPatch(values({ copyright: '', github: '', x: '', linkedin: '' }), BASE))).toStrictEqual({
      copyright: '',
      github: '',
      x: '',
      linkedin: '',
    });
  });

  it('sends the badge only when switched, as an explicit true or false', () => {
    expect(projectFooterPatch(values({ madeWithBadge: true }), BASE)).toStrictEqual({ madeWithBadge: true });
    expect(projectFooterPatch(footerValues({ madeWithBadge: false }), footerValues({}))).toStrictEqual({ madeWithBadge: false });
  });

  it('never sends a key the person left alone: a never-set copyright stays unset, typed then cleared included', () => {
    const neverSet = footerValues({ github: 'https://github.com/acme' });
    expect(projectFooterPatch({ ...neverSet, x: 'https://x.com/acme' }, neverSet)).toStrictEqual({ x: 'https://x.com/acme' });
    expect(projectFooterPatch({ ...neverSet, copyright: '   ' }, neverSet)).toStrictEqual({});
  });

  it('a whitespace-only change to a stored text sends nothing', () => {
    expect(projectFooterPatch(values({ github: ' https://github.com/acme ' }), BASE)).toStrictEqual({});
  });

  it('keeps the URL contract: relative and absolute addresses pass, an unsafe scheme is refused', () => {
    for (const github of ['/team', 'https://github.com/acme-labs', 'mailto:team@acme.example', '#contact']) {
      expect(onTheWire(projectFooterPatch(values({ github }), BASE))?.github).toBe(github);
    }
    expect(() => onTheWire(projectFooterPatch(values({ x: 'javascript:alert(1)' }), BASE))).toThrow();
  });
});

describe('languageFooterConfig', () => {
  it('sends the trimmed copyright only, or null when blank; both pass the language validator', () => {
    const edited = values({ copyright: '  © أكمي ' });
    expect(languageFooterConfig(edited)).toStrictEqual({ footer: { copyright: '© أكمي' } });
    expect(languageFooterConfig(values({ copyright: '  ' }))).toStrictEqual({ footer: null });
    for (const config of [languageFooterConfig(edited), languageFooterConfig(values({ copyright: '' }))]) {
      expect(updateLanguageBody.parse(JSON.parse(JSON.stringify({ config }))).config).toStrictEqual(config);
    }
  });

  it('refuses the global fields in a language footer, as the API does', () => {
    expect(updateLanguageBody.safeParse({ config: { footer: { copyright: 'x', github: 'https://github.com/acme' } } }).success).toBe(false);
  });
});

describe('sentFooterValues', () => {
  it('reads back what a project save stores: every text trimmed, a cleared one blank', () => {
    expect(sentFooterValues('project', values({ copyright: ' New ', x: ' ' }))).toStrictEqual({
      ...footerValues(STORED),
      copyright: 'New',
      x: '',
    });
  });

  it('a language save changes the copyright only', () => {
    const draft = values({ copyright: ' © أكمي ' });
    expect(sentFooterValues('language', draft)).toStrictEqual({ ...draft, copyright: '© أكمي' });
  });
});
