import type { MessageKey } from '@nibleaf/i18n';
import { Link } from '@tanstack/react-router';

/**
 * The element Preview renders as, for a `render` prop: the draft preview in
 * the dashboard, or the live site in a new tab. Each names where it goes, and
 * both names contain the visible "Preview".
 */
export function sitePreviewLink(projectId: string, draft: boolean, t: (key: MessageKey) => string) {
  return draft ? (
    <Link aria-label={t('project.previewDraftAria')} params={{ projectId }} to="/app/projects/$projectId/preview" />
  ) : (
    // biome-ignore lint/a11y/useAnchorContent: content is merged from the children via Base UI's render prop
    <a aria-label={t('project.previewLiveAria')} href={`/sites/${projectId}`} rel="noreferrer" target="_blank" />
  );
}
