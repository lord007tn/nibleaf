import type { MessageKey } from '@nibleaf/i18n';
import type { SectionId } from './ids';

/**
 * The settings nav (operations/ui-overhaul.md §5.7): two levels, the app
 * sidebar and this list, every item a page. Groups in order; the Danger zone
 * comes last, on its own, without a group label.
 */
export const SETTINGS_GROUPS = [
  { id: 'website', labelKey: 'settings.group.website', sections: ['general', 'appearance', 'languages', 'domain', 'authentication', 'addons'] },
  { id: 'content', labelKey: 'settings.group.content', sections: ['seo', 'redirects', 'variables', 'search'] },
  { id: 'publishing', labelKey: 'settings.group.publishing', sections: ['git', 'openapi', 'contentImport', 'exports'] },
  { id: 'ai', labelKey: 'settings.group.ai', sections: ['ai', 'apiKeys', 'integrations'] },
  { id: 'team', labelKey: 'settings.group.team', sections: ['members'] },
  { id: 'usage', labelKey: 'settings.group.usage', sections: ['usage'] },
  { id: 'danger', labelKey: null, sections: ['danger'] },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey | null; sections: readonly SectionId[] }>;

/** A section's nav label. */
export const sectionLabelKey = (id: SectionId): MessageKey => (id === 'appearance' ? 'settings.tab.appearance' : `settings.${id}`);

/**
 * Content languages, team visibility, usage, one-time exports and API keys
 * are open to editors, and AI answers to everyone on the site (read-only below
 * Admin: where answers stand, never a key). Everything else writes operational
 * settings guarded by the site Admin role.
 */
const EDITOR_SECTIONS: ReadonlySet<SectionId> = new Set(['languages', 'members', 'usage', 'exports', 'apiKeys', 'ai']);
/**
 * Viewers see the same sections read-only, except API keys: a key carries its
 * creator's write access, and the server refuses Viewers the key list.
 */
const VIEWER_SECTIONS: ReadonlySet<SectionId> = new Set(['languages', 'members', 'usage', 'exports', 'ai']);

export type SettingsAccess = {
  /** Site Admin or Owner. */
  canManage: boolean;
  /** Site Member or above. */
  canEditContent: boolean;
  /** Organization Owner or Admin: deleting the website is theirs alone (§4.2), not a site Admin's. */
  orgAdmin: boolean;
};

/** Whether this person may open a section. UI policy only: the server checks every request. */
export function sectionAllowed(id: SectionId, access: SettingsAccess): boolean {
  if (id === 'danger') return access.orgAdmin;
  if (access.canManage) return true;
  return (access.canEditContent ? EDITOR_SECTIONS : VIEWER_SECTIONS).has(id);
}

/** The nav this person sees: each group with the sections they may open, empty groups dropped. */
export function settingsNav(access: SettingsAccess) {
  return SETTINGS_GROUPS.map((group) => ({ ...group, sections: group.sections.filter((id) => sectionAllowed(id, access)) })).filter(
    (group) => group.sections.length > 0,
  );
}

/** Sections whose content uses the wide column. */
export const WIDE_SECTIONS: ReadonlySet<SectionId> = new Set(['general', 'usage', 'integrations', 'exports']);
