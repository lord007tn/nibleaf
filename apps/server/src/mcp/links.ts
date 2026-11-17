import { env } from '@/env';
import type { McpAuditTarget } from './types';

/** Where the dashboard lives for the bound website. */
export const dashboardBase = (projectId: string) => `${env.APP_URL.replace(/\/+$/, '')}/app/projects/${encodeURIComponent(projectId)}`;

/**
 * Links back into the dashboard for what a write tool just did, so the
 * assistant can hand the person the place to review it:
 * - a page write → `reviewUrl`, that page open in the editor;
 * - `preview_publish` → `publishDialogUrl`, the editor's publish dialog (it only
 *   opens the dialog; publishing still needs the person's click);
 * - `publish_changes` → `deploymentUrl`, that publish's status page.
 *
 * Built from the bound website and the audited target, never stored: a replay
 * (whose stored record names the same target) gets the same links, and a link
 * carries no token or other secret.
 */
export const dashboardLinks = (operation: string, projectId: string, target: McpAuditTarget | null): Record<string, string> => {
  const base = dashboardBase(projectId);
  if (target?.type === 'page' && target.id) return { reviewUrl: `${base}/editor?page=${encodeURIComponent(target.id)}` };
  if (target?.type === 'deployment' && target.id) return { deploymentUrl: `${base}/publishes/${encodeURIComponent(target.id)}` };
  if (operation === 'preview_publish') return { publishDialogUrl: `${base}/editor?publish=true` };
  return {};
};
