/**
 * What a page renders, and whether its internal links reach a page, for the
 * pre-publish checks. One implementation, shared by the publish dialog's
 * preflight (apps/server) and the publish worker's gate (apps/worker), so the
 * dialog never calls a publish "allowed" that the worker then rejects.
 *
 * SERVER-ONLY: this parses Markdown/MDX with remark. The reader must never
 * import it; it imports only `./site-route` and `./site-links`, which hold the
 * route and link logic the browser shares.
 *
 * - Links are read the way the reader renders the page: its own source
 *   normalization (`normalizeMdxBlocks`), then CommonMark + GFM, then raw HTML
 *   through parse5 (rehype-raw). A link counts only when it renders as one:
 *   code, comments, text that merely looks like a tag, and discarded HTML
 *   contexts render no link. Attribute destinations come from `<a>` and the
 *   components whose reader contract declares an `href`.
 *   Reference links resolve through their definition (CommonMark: the first
 *   definition of a label wins); a definition nothing uses renders nothing.
 * - A link is rendered as the reader renders it (relative to the page URL, or
 *   root-relative with the page's version prefix and language), then resolved
 *   with `resolveSiteRoute`, the reader's own route order, following redirects
 *   (`./site-links`, shared with the dashboard editor).
 */
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { collectPageContentFacts, type PageContentFacts } from './page-content-facts';
import { publicLanguages, type SiteSnapshot, type SnapshotPage } from './site';
import { createLinkResolver } from './site-links';
import { sitePathTooLong } from './site-route';

const objectValue = (value: unknown): Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]' ? (value as Record<string, unknown>) : {};

/**
 * Whether publishing enforces the broken-link check for this snapshot: the
 * CI-checks umbrella and the broken-links add-on are both on (each defaults to
 * on) in the snapshot's DELIVERED add-on state.
 *
 * The snapshot's `project.config.addons` is the plan projection built by
 * `buildSnapshot` + `projectAddonRowsForDelivery`: an add-on the site's plan
 * doesn't deliver reads as off even when its stored row is on. That is the
 * state the publish worker has always gated on, and the dialog must match it,
 * so this takes the snapshot rather than a raw stored `project.config`.
 */
export const brokenLinkCheckEnabledForSnapshot = (snapshot: SiteSnapshot): boolean => {
  const addons = objectValue(objectValue(snapshot.project.config).addons);
  return addons.ciChecks !== false && addons.brokenLinks !== false;
};

/** Parsing is the dominant cost; the dialog re-reads the same draft on every
 *  open and again right before publishing, so results are cached per content. */
const CACHE_LIMIT = 2000;
const factsCache = new Map<string, PageContentFacts>();

/** What a page's content renders that the checks look at (cached per content). */
export const pageContentFacts = (content: string, cache = true): PageContentFacts => {
  const key = createHash('sha1').update(content).digest('base64');
  const cached = factsCache.get(key);
  if (cached) {
    factsCache.delete(key);
    factsCache.set(key, cached);
    return cached;
  }
  const facts = collectPageContentFacts(content);
  if (!cache) return facts;
  factsCache.set(key, facts);
  if (factsCache.size > CACHE_LIMIT) {
    const oldest = factsCache.keys().next().value;
    if (oldest !== undefined) factsCache.delete(oldest);
  }
  return facts;
};

/** Facts per snapshot, by content. A site with more pages than the shared cache
 *  holds would evict it in order on every scan, so a second pass (publish checks
 *  read each page twice) or a repeat open re-parsed every page. Keyed by the
 *  snapshot's pages array, like the page index in site-route, so the facts live
 *  as long as the snapshot; the shared cache still carries facts across
 *  snapshots of sites that fit in it. */
const snapshotFacts = new WeakMap<readonly SnapshotPage[], Map<string, PageContentFacts>>();

/** `pageContentFacts` for one snapshot's pages, parsed at most once per content. */
export const snapshotContentFacts = (snapshot: SiteSnapshot): ((content: string) => PageContentFacts) => {
  const memo = snapshotFacts.get(snapshot.pages) ?? new Map<string, PageContentFacts>();
  snapshotFacts.set(snapshot.pages, memo);
  // A scan larger than the shared cache reuses its entries but adds none.
  const shared = snapshot.pages.length <= CACHE_LIMIT;
  return (content) => {
    let facts = memo.get(content);
    if (!facts) {
      facts = pageContentFacts(content, shared);
      memo.set(content, facts);
    }
    return facts;
  };
};

/* ------------------------------------------------------------------------ */
/* Links, rendered and routed as the reader does                             */
/* ------------------------------------------------------------------------ */

interface BrokenInternalLink {
  page: SnapshotPage;
  /** The link as authored, e.g. `/configuration#options`. */
  href: string;
  /** Set when the link is broken because it is longer than the reader serves. */
  reason?: 'path-too-long';
}

/**
 * Every internal link that renders on a published page and leads nowhere on
 * the live site, once per page and href, in page order. Hidden pages and
 * disabled languages are not published, so their links are not checked (and
 * hidden pages are not link targets).
 */
export function findBrokenInternalLinks(snapshot: SiteSnapshot): BrokenInternalLink[] {
  const served = new Set(publicLanguages(snapshot.project.languages).map((language) => language.code));
  const resolveLink = createLinkResolver(snapshot);
  const factsOf = snapshotContentFacts(snapshot);
  const broken: BrokenInternalLink[] = [];
  for (const page of snapshot.pages) {
    if (page.kind !== 'PAGE' || page.hidden || !served.has(page.languageCode)) continue;
    for (const href of new Set(factsOf(page.content).links)) {
      // Over-long links are rejected before any resolution work (the reader 404s them).
      if (sitePathTooLong(href)) broken.push({ page, href, reason: 'path-too-long' });
      else if (resolveLink(href, page) === false) broken.push({ page, href });
    }
  }
  return broken;
}

/** Draft pages outside a deleted subtree that render a link into it. Sources
 * stay on the target's branch; destinations follow the reader's version,
 * language, fallback and redirect rules. Hidden drafts are sources too.
 * Parsing uses the same per-content cache as publish checks. */
export interface InboundPageLinks {
  pages: Pick<SnapshotPage, 'id' | 'title' | 'path'>[];
  total: number;
}

/** Only the inbound advisory treats absolute URLs on trusted site hosts as
 * internal. Publish checks deliberately continue treating them as external.
 * URL normalizes host case and each scheme's default port. */
const stripSiteOrigin = (href: string, hosts: ReadonlySet<string>): string | null => {
  const trimmed = href.trim();
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('//')) return null;
  try {
    const url = new URL(trimmed, 'https://site.invalid');
    if (!hosts.has(url.host)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

/** Compute every deletion advisory in one scan. Keep only capped summaries
 * and counts, so the server can cache the branch map without retaining bodies
 * or unbounded inbound edge lists. */
function* inboundPageLinkSteps(snapshot: SiteSnapshot, trustedOrigins: readonly string[]): Generator<void, Map<string, InboundPageLinks>> {
  const hosts = new Set(trustedOrigins.map((origin) => new URL(origin).host));
  const byId = new Map<string, SnapshotPage>();
  const results = new Map<string, InboundPageLinks>();
  for (const page of snapshot.pages) {
    byId.set(page.id, page);
    results.set(page.id, { pages: [], total: 0 });
    yield;
  }
  const resolveLink = createLinkResolver(snapshot);
  const factsOf = snapshotContentFacts(snapshot);
  for (const page of snapshot.pages) {
    if (page.kind !== 'PAGE') continue;
    const ancestors = new Set<string>();
    for (let id: string | undefined = page.id; id && !ancestors.has(id); id = byId.get(id)?.parentId ?? undefined) ancestors.add(id);
    const affected = new Set<string>();
    for (const href of factsOf(page.content).links) {
      if (sitePathTooLong(href)) continue;
      const siteHref = stripSiteOrigin(href, hosts);
      // Full URLs already select their version/language. Unlike root-relative
      // authored links, the reader does not add the source page's context.
      const destination = resolveLink(siteHref ?? href, page, siteHref !== null);
      if (typeof destination !== 'object' || destination === null || destination.versionId !== page.versionId) continue;
      // A source inside an ancestor's subtree goes to Trash with it. Shared
      // ancestors of multiple destinations count only once for this source.
      for (let id: string | undefined = destination.id; id && !ancestors.has(id) && !affected.has(id); id = byId.get(id)?.parentId ?? undefined)
        affected.add(id);
    }
    const summary = { id: page.id, title: page.title, path: page.path };
    for (const id of affected) {
      const result = results.get(id);
      if (!result) continue;
      result.total += 1;
      if (result.pages.length < 20) result.pages.push(summary);
    }
    yield;
  }
  return results;
}

export function buildInboundPageLinkMap(snapshot: SiteSnapshot, trustedOrigins: readonly string[] = []): Map<string, InboundPageLinks> {
  const steps = inboundPageLinkSteps(snapshot, trustedOrigins);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Same ordered scan as the synchronous advisory, with an elapsed-time budget.
 * A page's parse is indivisible; check after each page rather than guessing how
 * many pages fit a slice. Clock/scheduler injection keeps slice tests untimed. */
export async function buildInboundPageLinkMapAsync(
  snapshot: SiteSnapshot,
  trustedOrigins: readonly string[] = [],
  {
    signal,
    sliceMs = 25,
    now = () => performance.now(),
    yieldToEventLoop = setImmediate,
  }: {
    signal?: AbortSignal;
    sliceMs?: number;
    now?: () => number;
    yieldToEventLoop?: () => Promise<unknown>;
  } = {},
): Promise<Map<string, InboundPageLinks>> {
  signal?.throwIfAborted();
  const steps = inboundPageLinkSteps(snapshot, trustedOrigins);
  let started = now();
  let step = steps.next();
  while (!step.done) {
    if (now() - started >= sliceMs) {
      await yieldToEventLoop();
      signal?.throwIfAborted();
      started = now();
    }
    step = steps.next();
  }
  signal?.throwIfAborted();
  return step.value;
}

export function findInboundPageLinks(snapshot: SiteSnapshot, pageId: string, trustedOrigins: readonly string[] = []): InboundPageLinks {
  return buildInboundPageLinkMap(snapshot, trustedOrigins).get(pageId) ?? { pages: [], total: 0 };
}
