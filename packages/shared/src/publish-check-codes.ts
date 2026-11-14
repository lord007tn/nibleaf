/**
 * Publish check codes (browser-safe): the one list of check codes, and the editor URL contract a
 * check's "Fix" follows. The API's checks, the publish sheet and the editor's
 * arrival all import these names, so a renamed code breaks the typecheck
 * instead of silently not matching (P1-ED-002, P2-DASH-011).
 *
 *   /app/projects/$projectId/editor?page=<pageId>&fix=<code>&fixTarget=<evidence>
 *
 * `fixTarget` is the check's evidence exactly as written in the page's Markdown.
 * It is sent only for a locatable check (below), and never when the server
 * shortened the evidence (`reason: 'path-too-long'`). Page-level checks send
 * `fix` alone; the editor focuses the field the code names.
 */
export const PUBLISH_CHECK_CODES = [
  'broken-internal-link',
  'missing-alt',
  'untitled-page',
  'stray-characters',
  'unreadable-slug',
  'empty-page',
  'duplicate-title',
  'embed-untitled',
  'embed-as-link',
  'video-not-https',
  'embed-unclosed',
  'video-poster-hidden',
  'home-untranslated',
  'blog-root-group',
] as const;

export type PublishCheckCode = (typeof PUBLISH_CHECK_CODES)[number];

/** Checks whose evidence is a thing on the page the editor can find: a link
 *  href, an image or poster src, a video or embed address, or stray text. */
export const LOCATABLE_PUBLISH_CHECK_CODES = [
  'broken-internal-link',
  'missing-alt',
  'video-poster-hidden',
  'video-not-https',
  'embed-as-link',
  'embed-untitled',
  'embed-unclosed',
  'stray-characters',
] as const satisfies readonly PublishCheckCode[];

const locatable: ReadonlySet<PublishCheckCode> = new Set(LOCATABLE_PUBLISH_CHECK_CODES);

export const isLocatablePublishCheck = (code: PublishCheckCode): boolean => locatable.has(code);

/** The editor search params a Fix sends. */
export interface PublishFixSearch {
  page: string;
  fix: PublishCheckCode;
  fixTarget?: string;
}

/** The editor search params for fixing one problem on one page. */
export function publishFixSearch(code: PublishCheckCode, pageId: string, evidence?: { detail: string; truncated?: boolean }): PublishFixSearch {
  const target = evidence && isLocatablePublishCheck(code) && !evidence.truncated ? evidence.detail : '';
  return target ? { page: pageId, fix: code, fixTarget: target } : { page: pageId, fix: code };
}
