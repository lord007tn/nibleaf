import type { MessageKey } from '@nibleaf/i18n';
import { Link } from '@tanstack/react-router';

/**
 * The element Preview renders as, for a `render` prop: the draft preview in
 * the dashboard, or the live site in a new tab. The visible "Preview" is the
 * link's name in every language (WCAG 2.5.3, label in name); where it goes is
 * the title, which is also its description.
 */
export function sitePreviewLink(projectId: string, draft: boolean, t: (key: MessageKey) => string) {
  return draft ? (
    <Link params={{ projectId }} title={t('project.previewDraftAria')} to="/app/projects/$projectId/preview" />
  ) : (
    // biome-ignore lint/a11y/useAnchorContent: content is merged from the children via Base UI's render prop
    <a href={`/sites/${projectId}`} rel="noreferrer" target="_blank" title={t('project.previewLiveAria')} />
  );
}
