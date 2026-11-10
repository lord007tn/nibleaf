// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { RecentWebsite, SwitcherOrganization, SwitcherWebsite } from '@/hooks/api/organization-query-options';
import {
  createSequenceHandler,
  initials,
  isEditableTarget,
  isTypingKey,
  matches,
  moveWithinPane,
  orderOrganizations,
  paneForArrow,
  SEQUENCE_TIMEOUT_MS,
  searchSwitcher,
} from './switcher-model';

const org = (id: string, name: string, orgRole: SwitcherOrganization['orgRole'] = 'member'): SwitcherOrganization => ({
  id,
  slug: id,
  name,
  logo: null,
  orgRole,
  canCreateWebsite: orgRole !== 'member',
  websiteCount: 1,
});
const site = (id: string, name: string, domain: string | null = null): SwitcherWebsite => ({ id, name, icon: null, domain, live: true });

describe('orderOrganizations', () => {
  it('puts the current organization first and keeps the server order after it', () => {
    const list = [org('a', 'Acme'), org('b', 'JOODPMS'), org('c', "Sara's org")];
    expect(orderOrganizations(list, 'c').map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(orderOrganizations(list, undefined).map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(orderOrganizations(list, 'unknown').map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('searchSwitcher', () => {
  const organizations = [org('acme', 'Acme Docs'), org('jood', 'JOODPMS')];
  const websites = new Map([
    ['acme', [site('api', 'API reference', 'acme.nibleaf.app'), site('docs', 'Developer docs', 'docs.acme.com')]],
    ['jood', [site('hand', 'Handbook')]],
  ]);
  const recent: RecentWebsite[] = [{ ...site('api', 'API reference'), organization: { id: 'acme', slug: 'acme', name: 'Acme Docs' } }];

  it('returns one flat list: organizations first, then websites with their org', () => {
    const results = searchSwitcher('docs', organizations, websites, recent);
    expect(results.map((result) => result.kind)).toEqual(['organization', 'website']);
    const website = results[1];
    expect(website?.kind === 'website' && website.organization.name).toBe('Acme Docs');
  });

  it('matches domains and is case- and accent-insensitive', () => {
    expect(searchSwitcher('ACME.COM', organizations, websites, recent).map((result) => result.id)).toEqual(['site-docs']);
    expect(matches('resume', 'Résumé')).toBe(true);
  });

  it('lists a website once even when it is also recent, and finds recent websites of unloaded orgs', () => {
    expect(searchSwitcher('api', organizations, websites, recent).filter((result) => result.kind === 'website')).toHaveLength(1);
    expect(searchSwitcher('api', organizations, new Map(), recent).map((result) => result.id)).toEqual(['site-api']);
  });

  it('matches Arabic names', () => {
    const arabic = [org('ar', 'مؤسسة سارة')];
    expect(searchSwitcher('سارة', arabic, new Map(), [])).toHaveLength(1);
  });
});

describe('keyboard', () => {
  it('moves within a pane with Up/Down/Home/End and clamps at the ends', () => {
    expect(moveWithinPane('ArrowDown', 0, 3)).toBe(1);
    expect(moveWithinPane('ArrowDown', 2, 3)).toBe(2);
    expect(moveWithinPane('ArrowUp', 0, 3)).toBe(0);
    expect(moveWithinPane('Home', 2, 3)).toBe(0);
    expect(moveWithinPane('End', 0, 3)).toBe(2);
    expect(moveWithinPane('Enter', 0, 3)).toBeNull();
    expect(moveWithinPane('ArrowDown', 0, 0)).toBeNull();
  });

  it('moves between panes with Right/Left, mirrored in RTL', () => {
    expect(paneForArrow('ArrowRight', 'orgs', 'ltr')).toBe('websites');
    expect(paneForArrow('ArrowLeft', 'websites', 'ltr')).toBe('orgs');
    expect(paneForArrow('ArrowLeft', 'orgs', 'ltr')).toBeNull();
    // RTL: the organizations pane is on the right, so Left goes to the websites.
    expect(paneForArrow('ArrowLeft', 'orgs', 'rtl')).toBe('websites');
    expect(paneForArrow('ArrowRight', 'websites', 'rtl')).toBe('orgs');
    expect(paneForArrow('ArrowRight', 'orgs', 'rtl')).toBeNull();
  });

  it('treats printable keys without modifiers as typing', () => {
    expect(isTypingKey({ key: 'a', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isTypingKey({ key: 'س', ctrlKey: false, metaKey: false, altKey: false })).toBe(true);
    expect(isTypingKey({ key: 'a', ctrlKey: true, metaKey: false, altKey: false })).toBe(false);
    expect(isTypingKey({ key: 'ArrowDown', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
    expect(isTypingKey({ key: ' ', ctrlKey: false, metaKey: false, altKey: false })).toBe(false);
  });
});

describe('G then O / G then W sequences', () => {
  const press = (handler: ReturnType<typeof createSequenceHandler>, key: string, target: EventTarget | null = document.body, extra = {}) =>
    handler({ key, ctrlKey: false, metaKey: false, altKey: false, defaultPrevented: false, target, ...extra });

  it('opens the organization switcher with G then O and the website switcher with G then W', () => {
    const actions = { organization: vi.fn(), website: vi.fn() };
    const handler = createSequenceHandler(actions, () => 0);
    expect(press(handler, 'g')).toBe(false);
    expect(press(handler, 'o')).toBe(true);
    expect(actions.organization).toHaveBeenCalledOnce();
    press(handler, 'G');
    press(handler, 'W');
    expect(actions.website).toHaveBeenCalledOnce();
  });

  it('ignores the sequence while typing in a field, with modifiers, or after the timeout', () => {
    const actions = { organization: vi.fn(), website: vi.fn() };
    let now = 0;
    const handler = createSequenceHandler(actions, () => now);
    const input = document.createElement('input');
    press(handler, 'g', input);
    press(handler, 'o', input);
    press(handler, 'g');
    press(handler, 'o', document.body, { ctrlKey: true });
    press(handler, 'g');
    now = SEQUENCE_TIMEOUT_MS + 1;
    press(handler, 'o');
    expect(actions.organization).not.toHaveBeenCalled();
  });

  it('knows editable targets', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
  });
});

it('makes initials from the first two words, any script', () => {
  expect(initials('Acme Docs')).toBe('AD');
  expect(initials('JOODPMS')).toBe('J');
  expect(initials('مؤسسة سارة')).toBe('مس');
  expect(initials('  ')).toBe('?');
});
