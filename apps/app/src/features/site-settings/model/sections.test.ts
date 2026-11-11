import { describe, expect, it } from 'vitest';
import { MOVED_SECTION_IDS, parseSettingsSearch, SECTION_IDS } from './ids';
import { SETTINGS_GROUPS, type SettingsAccess, sectionAllowed, sectionLabelKey, settingsNav } from './sections';

const owner: SettingsAccess = { canManage: true, canEditContent: true, orgAdmin: true };
const siteAdmin: SettingsAccess = { canManage: true, canEditContent: true, orgAdmin: false };
const editor: SettingsAccess = { canManage: false, canEditContent: true, orgAdmin: false };
const viewer: SettingsAccess = { canManage: false, canEditContent: false, orgAdmin: false };
const navIds = (access: SettingsAccess) => settingsNav(access).flatMap((group) => group.sections);

describe('settings sections', () => {
  it('puts every section in exactly one group, in nav order', () => {
    expect(SETTINGS_GROUPS.flatMap((group) => group.sections)).toEqual([...SECTION_IDS]);
  });

  it('orders the groups as §5.7 does, with the Danger zone last and unlabelled', () => {
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual(['website', 'content', 'publishing', 'ai', 'team', 'usage', 'danger']);
    expect(SETTINGS_GROUPS.at(-1)).toMatchObject({ labelKey: null, sections: ['danger'] });
  });

  it('labels Appearance with its tab name and the rest by id', () => {
    expect(sectionLabelKey('appearance')).toBe('settings.tab.appearance');
    expect(sectionLabelKey('redirects')).toBe('settings.redirects');
  });

  it('gives the Danger zone to organization Owners and Admins only, never to a site-only Admin', () => {
    expect(sectionAllowed('danger', owner)).toBe(true);
    expect(sectionAllowed('danger', siteAdmin)).toBe(false);
    expect(navIds(siteAdmin)).not.toContain('danger');
    expect(navIds(siteAdmin)).toEqual(SECTION_IDS.filter((id) => id !== 'danger'));
  });

  it('opens content languages, members, usage, exports and API keys to editors', () => {
    expect(navIds(editor)).toEqual(['languages', 'exports', 'apiKeys', 'members', 'usage']);
    expect(settingsNav(editor).map((group) => group.id)).toEqual(['website', 'publishing', 'ai', 'team', 'usage']);
  });

  it('shows Viewers the same, except API keys', () => {
    expect(navIds(viewer)).toEqual(['languages', 'exports', 'members', 'usage']);
  });

  it('keeps the promoted Content pages for site Admins', () => {
    for (const id of ['seo', 'redirects', 'variables', 'search'] as const) {
      expect(sectionAllowed(id, siteAdmin)).toBe(true);
      expect(sectionAllowed(id, editor)).toBe(false);
    }
  });
});

describe('parseSettingsSearch', () => {
  it('keeps an absent section absent and drops unknown ones', () => {
    expect(parseSettingsSearch({})).toEqual({ section: undefined });
    expect(parseSettingsSearch({ section: 'nope' })).toEqual({ section: undefined });
    expect(parseSettingsSearch({ section: 42 })).toEqual({ section: undefined });
  });

  it('accepts every section and every moved section', () => {
    for (const section of [...SECTION_IDS, ...MOVED_SECTION_IDS]) expect(parseSettingsSearch({ section })).toEqual({ section });
  });

  it('opens the page an old Appearance subsection link pointed at', () => {
    for (const page of ['seo', 'redirects', 'variables', 'search']) {
      expect(parseSettingsSearch({ section: 'appearance', appearanceSection: page })).toEqual({ section: page });
    }
  });

  it("keeps Appearance's own subsections, only under Appearance", () => {
    expect(parseSettingsSearch({ section: 'appearance', appearanceSection: 'navbar' })).toEqual({
      section: 'appearance',
      appearanceSection: 'navbar',
    });
    expect(parseSettingsSearch({ section: 'appearance', appearanceSection: 'arbitrary' })).toEqual({ section: 'appearance' });
    expect(parseSettingsSearch({ section: 'appearance', appearanceSection: 'toString' })).toEqual({ section: 'appearance' });
    expect(parseSettingsSearch({ section: 'general', appearanceSection: 'navbar' })).toEqual({ section: 'general' });
    expect(parseSettingsSearch({ section: 'general', appearanceSection: 'redirects' })).toEqual({ section: 'general' });
  });

  // Council #456: an inherited property passed as a section left a blank page.
  it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])('drops the inherited name %s', (name) => {
    expect(parseSettingsSearch({ section: name })).toEqual({ section: undefined });
    expect(parseSettingsSearch({ section: 'appearance', appearanceSection: name })).toEqual({ section: 'appearance' });
  });

  it('sends the old Analytics section to Integrations', () => {
    expect(parseSettingsSearch({ section: 'analytics' })).toEqual({ section: 'integrations' });
  });
});
