import type { Project } from '@/hooks/api/types';

/**
 * Whether Preview shows the draft: preview deployments are on unless the site
 * turned them off. Without the site yet, Preview goes to the live site.
 */
export function previewsDraft(project: Pick<Project, 'config'> | undefined): boolean {
  return project ? project.config?.addons?.previewDeployments !== false : false;
}
