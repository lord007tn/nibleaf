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

export const isSampleSite = (project: Pick<Project, 'name' | 'description'>) =>
  project.name === SAMPLE_NAME && project.description === SAMPLE_DESCRIPTION;

const isStarterPublish = (deployment: Pick<Deployment, 'version' | 'commitMessage'>) =>
  deployment.version === 1 && deployment.commitMessage === STARTER_PUBLISH_MESSAGE;

/**
 * What the dashboard loaded for the sample site to judge whether the user edited
 * it: its publish history (for the starter publish's time) and its page list.
 * Missing means "not loaded" — never "none".
 */
export interface SiteActivity {
  deployments?: Pick<Deployment, 'version' | 'commitMessage' | 'createdAt'>[];
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
  /**
   * Every step's answer has arrived. Until then the checklist stays hidden, so
   * someone who finished it never sees it flash in with steps unticked.
   */
  known: boolean;
}

const newestFirst = (list: Project[]) => [...list].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

const focusSite = (projects: Project[]) => newestFirst(projects.filter((project) => !isSampleSite(project)))[0] ?? newestFirst(projects)[0] ?? null;

const ownPagesExist = (projects: Project[]) => projects.some((project) => !isSampleSite(project) && (project._count?.pages ?? 0) > 0);

/**
 * Whether one of the user's publishes went live, on any site. The sites list
 * reports it per site (`livePublishes`, which leaves out the sample's automatic
 * first publish), so no site's publish history has to be read and none can be
 * missed. Undefined while a site lacks the summary.
 */
const livePublishState = (projects: Project[]): boolean | undefined => {
  if (projects.some((project) => (project.livePublishes ?? 0) > 0)) return true;
  return projects.every((project) => project.livePublishes !== undefined) ? false : undefined;
};

/**
 * What the checklist still has to read: the sample's page list (and its publish
 * history, for when the starter publish happened), only while writing isn't
 * already settled by a page in the user's own site or by a live publish.
 */
export function startHereRequests(projects: Project[]): { deploymentSiteIds: string[]; pageSiteIds: string[] } {
  if (ownPagesExist(projects) || livePublishState(projects)) return { deploymentSiteIds: [], pageSiteIds: [] };
  const samples = projects.filter(isSampleSite);
  return {
    deploymentSiteIds: samples.filter((project) => (project._count?.deployments ?? 0) > 0).map((project) => project.id),
    pageSiteIds: samples.map((project) => project.id),
  };
}

/** The sample's publish history as far as it matters: known to be empty when it never published. */
const sampleHistory = (project: Project, activity: SiteActivity | undefined) =>
  activity?.deployments ?? ((project._count?.deployments ?? 0) === 0 ? [] : undefined);

/** Whether everything needed to judge edits to the sample has loaded. */
const sampleActivityLoaded = (project: Project, activity: SiteActivity | undefined) =>
  Boolean(activity?.pages) && sampleHistory(project, activity) !== undefined;

/**
 * Whether the user changed or added a page in the sample. Seeding finishes before
 * the starter publish is queued, so any page saved after that publish (or, if it
 * never got queued, after a short seeding window) is the user's work.
 */
const editedSample = (project: Project, activity: SiteActivity | undefined) => {
  const history = sampleHistory(project, activity);
  if (!activity?.pages || !history) return false;
  const starter = history.find(isStarterPublish);
  const since = starter ? Date.parse(starter.createdAt) : Date.parse(project.createdAt) + SAMPLE_SEED_WINDOW_MS;
  return activity.pages.some((page) => Date.parse(page.updatedAt) > since);
};

/**
 * Derive the first-run checklist from data the dashboard already has.
 * `teamSize` is the focus site's members + pending invitations (undefined while unknown).
 * `activity` holds what {@link startHereRequests} asked for, keyed by site id. A
 * step is never ticked on a guess, and `known` stays false until every answer is in.
 */
export function startHereProgress(
  projects: Project[],
  teamSize: number | undefined,
  activity: ReadonlyMap<string, SiteActivity> = new Map(),
): StartHereProgress {
  const liveState = livePublishState(projects);
  const published = liveState === true;
  const samples = projects.filter(isSampleSite);
  // Publishing implies writing; otherwise a page in a site the user created, or a
  // change they made to the sample, counts.
  const wroteSettled = published || ownPagesExist(projects);
  const wrote = wroteSettled || samples.some((project) => editedSample(project, activity.get(project.id)));
  const wroteKnown = wroteSettled || samples.every((project) => sampleActivityLoaded(project, activity.get(project.id)));
  const invited = (teamSize ?? 0) > 1;
  return {
    focus: focusSite(projects),
    hasSample: samples.length > 0,
    wrote,
    published,
    invited,
    done: [wrote, published, invited].filter(Boolean).length,
    total: 3,
    known: liveState !== undefined && teamSize !== undefined && wroteKnown,
  };
}
