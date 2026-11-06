import type { Deployment, PageNode, Project } from '@/hooks/api/types';

/**
 * Sign-up auto-creates and auto-publishes a starter site (see
 * `packages/auth/src/server.ts`). There's no flag on the record, so recognise it
 * by the exact name + description the server seeds; a renamed starter is
 * treated as the user's own site, which is what they've made it.
 */
const SAMPLE_NAME = 'Documentation';
const SAMPLE_DESCRIPTION = 'Your first documentation site.';
/** The commit message `publishStarterSite` gives the sample's automatic first publish (always version 1). */
const STARTER_PUBLISH_MESSAGE = 'Publish starter site';
/** Without the starter publish's timestamp, give the sign-up seeding this long before a page change counts as the user's. */
const SAMPLE_SEED_WINDOW_MS = 60_000;
/** Most sites whose publish history the dashboard reads for the checklist (newest activity first). */
export const START_HERE_MAX_SITES = 5;

export const isSampleSite = (project: Pick<Project, 'name' | 'description'>) =>
  project.name === SAMPLE_NAME && project.description === SAMPLE_DESCRIPTION;

const isStarterPublish = (deployment: Pick<Deployment, 'version' | 'commitMessage'>) =>
  deployment.version === 1 && deployment.commitMessage === STARTER_PUBLISH_MESSAGE;

/**
 * What the dashboard loaded per site to judge progress. `deployments` is the
 * site's publish history; `pages` its page list (only read for the sample).
 * Missing means "not loaded" — never "none".
 */
export interface SiteActivity {
  deployments?: Pick<Deployment, 'status' | 'version' | 'commitMessage' | 'createdAt'>[];
  pages?: Pick<PageNode, 'updatedAt'>[];
}

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

const newestFirst = (list: Project[]) => [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

const focusSite = (projects: Project[]) => newestFirst(projects.filter((project) => !isSampleSite(project)))[0] ?? newestFirst(projects)[0] ?? null;

const ownPagesExist = (projects: Project[]) => projects.some((project) => !isSampleSite(project) && (project._count?.pages ?? 0) > 0);

/**
 * Which sites' publish history and page lists the checklist needs.
 * Publish history: the focus site (its count can lag right after a publish) plus
 * every site that has ever started a publish, capped at {@link START_HERE_MAX_SITES}
 * in the server's most-recently-updated order. Pages: the sample, only while the
 * user hasn't written in a site of their own (otherwise step 1 is already done).
 */
export function startHereRequests(projects: Project[]): { deploymentSiteIds: string[]; pageSiteIds: string[] } {
  const focusId = focusSite(projects)?.id;
  const deploymentSiteIds = projects
    .filter((project) => project.id === focusId || (project._count?.deployments ?? 0) > 0)
    .slice(0, START_HERE_MAX_SITES)
    .map((project) => project.id);
  const pageSiteIds = ownPagesExist(projects) ? [] : projects.filter(isSampleSite).map((project) => project.id);
  return { deploymentSiteIds, pageSiteIds };
}

/** A publish that actually went live and that the user made: the sample's automatic first publish doesn't count. */
const hasOwnLivePublish = (project: Project, activity: SiteActivity | undefined) =>
  (activity?.deployments ?? []).some((deployment) => deployment.status === 'READY' && !(isSampleSite(project) && isStarterPublish(deployment)));

/**
 * Whether the user changed or added a page in the sample. Seeding finishes before
 * the starter publish is queued, so any page saved after that publish (or, if it
 * never got queued, after a short seeding window) is the user's work.
 */
const editedSample = (project: Project, activity: SiteActivity | undefined) => {
  if (!activity?.pages) return false;
  const knownHistory = activity.deployments ?? ((project._count?.deployments ?? 0) === 0 ? [] : undefined);
  if (!knownHistory) return false;
  const starter = knownHistory.find(isStarterPublish);
  const since = starter ? Date.parse(starter.createdAt) : Date.parse(project.createdAt) + SAMPLE_SEED_WINDOW_MS;
  return activity.pages.some((page) => Date.parse(page.updatedAt) > since);
};

/**
 * Derive the first-run checklist from data the dashboard already has.
 * `teamSize` is the focus site's members + pending invitations (undefined while unknown).
 * `activity` holds what {@link startHereRequests} asked for, keyed by site id; until
 * it arrives a step stays open rather than being ticked on a guess.
 */
export function startHereProgress(
  projects: Project[],
  teamSize: number | undefined,
  activity: ReadonlyMap<string, SiteActivity> = new Map(),
): StartHereProgress {
  const published = projects.some((project) => hasOwnLivePublish(project, activity.get(project.id)));
  // Publishing implies writing; otherwise a page in a site the user created, or a
  // change they made to the sample, counts.
  const wrote =
    published || ownPagesExist(projects) || projects.some((project) => isSampleSite(project) && editedSample(project, activity.get(project.id)));
  const invited = (teamSize ?? 0) > 1;
  return {
    focus: focusSite(projects),
    hasSample: projects.some(isSampleSite),
    wrote,
    published,
    invited,
    done: [wrote, published, invited].filter(Boolean).length,
    total: 3,
  };
}
