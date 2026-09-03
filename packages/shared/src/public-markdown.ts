export interface PublicMarkdownPage {
  project: { config?: { visibility?: string; seo?: { allowIndex?: boolean } } | null };
  languageConfig?: { seo?: { allowIndex?: boolean } } | null;
  page: {
    config?: { seo?: { noindex?: boolean; canonicalUrl?: string } } | null;
  };
}

/** One fail-closed eligibility rule shared by delivery and reader controls. */
export const isPublicMarkdownPage = (data: PublicMarkdownPage): boolean => {
  const project = data.project.config;
  const pageSeo = data.page.config?.seo;
  return (
    project?.visibility === 'public' &&
    project?.seo?.allowIndex !== false &&
    data.languageConfig?.seo?.allowIndex !== false &&
    pageSeo?.noindex !== true &&
    !pageSeo?.canonicalUrl?.trim()
  );
};
