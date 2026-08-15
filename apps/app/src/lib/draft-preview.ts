export interface DraftPreviewTarget {
  branchId?: string;
  languageId?: string;
  pageId?: string;
}

/** Build the authenticated URL that renders an unpublished project draft. */
export function draftPreviewHref(projectId: string, target: DraftPreviewTarget = {}): string {
  const search = new URLSearchParams();
  if (target.branchId) {
    search.set('branchId', target.branchId);
  }
  if (target.languageId) {
    search.set('languageId', target.languageId);
  }
  if (target.pageId) {
    search.set('pageId', target.pageId);
  }

  const query = search.toString();
  const pathname = `/app/projects/${encodeURIComponent(projectId)}/preview`;
  return query ? `${pathname}?${query}` : pathname;
}
