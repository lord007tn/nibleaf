/** The part of a site's config Preview depends on (a plain value, not the API type). */
export type PreviewConfig = { config?: { addons?: { previewDeployments?: boolean } | null } | null };

/**
 * Whether Preview shows the draft: preview deployments are on unless the site
 * turned them off. Without the site yet, Preview goes to the live site.
 */
export function previewsDraft(project: PreviewConfig | undefined): boolean {
  return project ? project.config?.addons?.previewDeployments !== false : false;
}
