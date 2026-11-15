import { updateLanguageBody, updateProjectBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import {
  type FooterValues,
  footerValues,
  knownStoredFooter,
  languageFooterConfig,
  languageFooterValues,
  projectFooterPatch,
  sentFooterValues,
} from './footer';

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

describe('projectFooterPatch', () => {
  it('trims every text and keeps the badge choice', () => {
    expect(projectFooterPatch(values({ copyright: '  © Acme 2026 ', github: ' https://github.com/acme ' }), STORED)).toStrictEqual({
      ...STORED,
      copyright: '© Acme 2026',
    });
  });

  it.each(['copyright', 'github', 'x', 'linkedin'] as const)('a cleared stored %s is sent as "" and survives the validator', (key) => {
    const patch = projectFooterPatch(values({ [key]: '   ' }), STORED);
    expect(patch[key]).toBe('');
    expect(onTheWire(patch)).toStrictEqual({ ...STORED, [key]: '' });
  });

  it('clears all four texts at once, keeping an explicit badge false', () => {
    const patch = projectFooterPatch(values({ copyright: '', github: '', x: '', linkedin: '' }), STORED);
    expect(onTheWire(patch)).toStrictEqual({ copyright: '', github: '', x: '', linkedin: '', madeWithBadge: false });
  });

  it('leaves out a text the project never stored, so the automatic copyright line stays', () => {
    const patch = projectFooterPatch(footerValues({ github: 'https://github.com/acme' }), { github: 'https://github.com/acme' });
    expect(patch).toStrictEqual({ github: 'https://github.com/acme', madeWithBadge: true });
    expect('copyright' in patch).toBe(false);
  });

  it('keeps the URL contract: relative and absolute addresses pass, an unsafe scheme is refused', () => {
    for (const github of ['/team', 'https://github.com/acme', 'mailto:team@acme.example', '#contact']) {
      expect(onTheWire(projectFooterPatch(values({ github }), STORED))?.github).toBe(github);
    }
    expect(() => onTheWire(projectFooterPatch(values({ x: 'javascript:alert(1)' }), STORED))).toThrow();
  });
});

describe('knownStoredFooter', () => {
  it("adds the text keys a save's response showed stored to what the query read, and keeps the query's values", () => {
    const known = knownStoredFooter({ github: 'https://github.com/acme' }, { copyright: 'New line', github: 'old', madeWithBadge: false });
    expect(known).toStrictEqual({ github: 'https://github.com/acme', copyright: 'New line' });
    expect(projectFooterPatch(footerValues({ github: 'https://github.com/acme' }), known)).toStrictEqual({
      copyright: '',
      github: 'https://github.com/acme',
      madeWithBadge: true,
    });
  });

  it('is the query alone when no save confirmed anything', () => {
    expect(knownStoredFooter({ x: '' }, undefined)).toStrictEqual({ x: '' });
    expect(knownStoredFooter(undefined, undefined)).toStrictEqual({});
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
  it('reads back what a project save stores: trimmed, cleared as blank', () => {
    expect(sentFooterValues('project', values({ copyright: ' New ', x: ' ' }), STORED)).toStrictEqual({
      ...footerValues(STORED),
      copyright: 'New',
      x: '',
    });
  });

  it('a language save changes the copyright only', () => {
    const draft = values({ copyright: ' © أكمي ' });
    expect(sentFooterValues('language', draft, STORED)).toStrictEqual({ ...draft, copyright: '© أكمي' });
  });
});
