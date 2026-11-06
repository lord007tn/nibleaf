import type { Project } from '@/hooks/api/types';

/**
 * Sign-up auto-creates and auto-publishes a starter site (see
 * `packages/auth/src/server.ts`). There's no flag on the record, so recognise it
 * by the exact name + description the server seeds; a renamed starter is
 * treated as the user's own site, which is what they've made it.
 */
const SAMPLE_NAME = 'Documentation';
const SAMPLE_DESCRIPTION = 'Your first documentation site.';

export const isSampleSite = (project: Pick<Project, 'name' | 'description'>) =>
  project.name === SAMPLE_NAME && project.description === SAMPLE_DESCRIPTION;

/** Publishes the user made themselves: the sample's automatic first publish doesn't count. */
const ownPublishes = (project: Project) => Math.max(0, (project._count?.deployments ?? 0) - (isSampleSite(project) ? 1 : 0));

export interface StartHereProgress {
  /** The site the "Start here" links open: the newest site the user made, else the sample. */
  focus: Project | null;
  hasSample: boolean;
  wrote: boolean;
  published: boolean;
  invited: boolean;
  done: number;
  total: 3;
}

/**
 * Derive the first-run checklist from data the dashboard already has.
 * `teamSize` is the focus site's members + pending invitations (undefined while unknown).
 */
export function startHereProgress(projects: Project[], teamSize: number | undefined): StartHereProgress {
  const own = projects.filter((project) => !isSampleSite(project));
  const newestFirst = (list: Project[]) => [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const focus = newestFirst(own)[0] ?? newestFirst(projects)[0] ?? null;
  const published = projects.some((project) => ownPublishes(project) > 0);
  // Publishing implies writing; otherwise a page in a site the user created counts.
  const wrote = published || own.some((project) => (project._count?.pages ?? 0) > 0);
  const invited = (teamSize ?? 0) > 1;
  return {
    focus,
    hasSample: projects.some(isSampleSite),
    wrote,
    published,
    invited,
    done: [wrote, published, invited].filter(Boolean).length,
    total: 3,
  };
}
