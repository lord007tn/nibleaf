import type { SiteSnapshot, SnapshotPage, SnapshotPageConfig, SnapshotProject } from './site';

export class AssetReferenceBudgetExceeded extends Error {
  constructor() {
    super('Published asset references exceed the processing budget.');
  }
}
export class AssetReferenceBudget {
  remaining: number;
  constructor(remaining: number) {
    this.remaining = remaining;
  }
  spend(units = 1): void {
    this.remaining -= units;
    if (this.remaining < 0) throw new AssetReferenceBudgetExceeded();
  }
}

/** Work tokens count characters and metadata steps, rather than request keys. */
export class AssetBuildTokens {
  private tokens: number;
  private at: number;
  constructor(
    readonly capacity: number,
    private readonly perSecond: number,
    private readonly clock = Date.now,
  ) {
    this.tokens = capacity;
    this.at = clock();
  }
  take(units: number): boolean {
    if (!Number.isFinite(units) || units < 0) return false;
    const now = this.clock();
    this.tokens = Math.min(this.capacity, this.tokens + (Math.max(0, now - this.at) * this.perSecond) / 1000);
    this.at = now;
    if (units > this.tokens) return false;
    this.tokens -= units;
    return true;
  }
}

export type PublishedAssetReferences = {
  version: 1;
  projectId: string;
  pageIds: string[];
  parents: number[];
  entries: [string, number[], number[]][];
  chromeKeys: string[];
  chromeBase: SnapshotProject;
  weight: number;
};
export const MAX_PUBLISHED_ASSET_INDEX_BYTES = 16 * 1024 * 1024;
const MAX_BINDINGS = 1_000_000;
const REFERENCE = /projects\/[A-Za-z0-9._~%+-]+\/assets\/[A-Za-z0-9._~%+/@!=;:$&-]+/g;

const decode = (text: string): string =>
  text.replace(/(?:%[0-9a-f]{2})+/gi, (part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });

/** Yield work before executing it. Drivers reserve global tokens outside the request callback. */
function* references(value: unknown, accept: (key: string) => void): Generator<number> {
  yield 1;
  if (typeof value === 'string') {
    yield value.length;
    for (const match of decode(value).matchAll(REFERENCE)) {
      yield match[0].length + 1;
      if (match[0].length > 2048) throw new AssetReferenceBudgetExceeded();
      accept(match[0]);
      yield 1;
    }
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      yield* references(key, accept);
      yield* references((value as Record<string, unknown>)[key], accept);
    }
  }
}

/** Only the presentation fields the navigation tree reads. */
const navigationConfig = (config: SnapshotPageConfig | null): SnapshotPageConfig | null => {
  if (!config) return null;
  const kept: SnapshotPageConfig = {};
  if (config.sidebarTitle !== undefined) kept.sidebarTitle = config.sidebarTitle;
  if (config.tag !== undefined) kept.tag = config.tag;
  if (config.category !== undefined) kept.category = config.category;
  if (config.categoryIcon !== undefined) kept.categoryIcon = config.categoryIcon;
  if (config.categoryOrder !== undefined) kept.categoryOrder = config.categoryOrder;
  return Object.keys(kept).length > 0 ? kept : null;
};

/** An ancestor kept for navigation becomes a body-less group: it can label and
 *  nest the granted pages, but no content surface treats it as a readable page. */
export const navigationOnly = (page: SnapshotPage): SnapshotPage => ({
  id: page.id,
  parentId: page.parentId,
  versionId: page.versionId,
  ...(page.createdAt !== undefined ? { createdAt: page.createdAt } : {}),
  updatedAt: page.updatedAt,
  languageCode: page.languageCode,
  kind: 'GROUP',
  title: page.title,
  slug: page.slug,
  path: page.path,
  icon: page.icon,
  description: null,
  content: '',
  config: navigationConfig(page.config),
  translationKey: page.translationKey,
  position: page.position,
  hidden: page.hidden,
});

/** Measure the traversal and serialization before fingerprinting a live chrome value in the background. */
export const serializedAssetReferenceValue = (value: unknown, spend: (units: number) => void): string => {
  let total = 0;
  for (const work of references(value, () => undefined)) {
    spend(work);
    total += work;
  }
  spend(total);
  return JSON.stringify(value);
};

/** Produced once by the publish worker, separate from the public snapshot. Arrays are already sorted for lookup. */
export function* assetReferenceIndexBuild(snapshot: SiteSnapshot, maxWork = 256 * 1024 * 1024): Generator<number, PublishedAssetReferences> {
  let remaining = maxWork;
  function* charge(units: number): Generator<number> {
    remaining -= units;
    if (remaining < 0) throw new AssetReferenceBudgetExceeded();
    yield units;
  }
  const pagesById = new Map<string, SnapshotPage>();
  for (const page of snapshot.pages) {
    yield* charge(page.id.length + 1);
    if (pagesById.has(page.id)) throw new Error('Duplicate published page id');
    pagesById.set(page.id, page);
  }
  const pageIds = [...pagesById.keys()];
  yield* charge(Math.ceil(pageIds.length * Math.log2(pageIds.length + 1)) * 32);
  pageIds.sort();
  const positions = new Map(pageIds.map((id, position) => [id, position]));
  const parents: number[] = [];
  const entries = new Map<string, [string, number[], number[]]>();
  let bindings = 0;
  for (const [position, id] of pageIds.entries()) {
    const page = pagesById.get(id);
    if (!page) throw new Error('Published page is missing');
    parents.push(page.parentId ? (positions.get(page.parentId) ?? -1) : -1);
    for (const [value, kind] of [
      [page, 1],
      [navigationOnly(page), 2],
    ] as const) {
      const accept = (key: string) => {
        let entry = entries.get(key);
        if (!entry) {
          const owned = Array.from(key).join('');
          entry = [owned, [], []];
          entries.set(owned, entry);
        }
        if (entry[kind].at(-1) !== position) {
          if (++bindings > MAX_BINDINGS) throw new AssetReferenceBudgetExceeded();
          entry[kind].push(position);
        }
      };
      for (const work of references(value, accept)) yield* charge(work);
    }
  }
  const chrome = new Set<string>();
  let chromeWork = 0;
  for (const work of references(snapshot.project, (key) => chrome.add(Array.from(key).join('')))) {
    chromeWork += work;
    yield* charge(work);
  }
  const sorted = [...entries.values()];
  yield* charge(Math.ceil(sorted.length * Math.log2(sorted.length + 1)) * 64);
  sorted.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const chromeKeys = [...chrome].sort();
  const index: PublishedAssetReferences = {
    version: 1,
    projectId: snapshot.project.id,
    pageIds,
    parents,
    entries: sorted,
    chromeKeys,
    chromeBase: snapshot.project,
    weight: 0,
  };
  // JSON characters and array/object overhead are charged before serialization, outside request handling.
  const estimated =
    pageIds.reduce((sum, id) => sum + id.length * 2 + 24, 0) +
    sorted.reduce((sum, entry) => sum + entry[0].length * 2 + (entry[1].length + entry[2].length) * 8 + 128, 0);
  yield* charge(estimated + chromeWork * 2);
  // Two bytes per UTF-16 code unit approximate hydrated strings; the extra terms cover array/object slots.
  index.weight = JSON.stringify(index).length * 2 + sorted.length * 96 + pageIds.length * 24;
  if (index.weight > MAX_PUBLISHED_ASSET_INDEX_BYTES) throw new AssetReferenceBudgetExceeded();
  return index;
}

export const buildAssetReferencesSync = (snapshot: SiteSnapshot, spend: (units: number) => void, maxWork?: number): PublishedAssetReferences => {
  const build = assetReferenceIndexBuild(snapshot, maxWork);
  let step = build.next();
  while (!step.done) {
    spend(step.value);
    step = build.next();
  }
  return step.value;
};

const contains = (positions: number[], position: number, budget: AssetReferenceBudget): boolean => {
  let low = 0;
  let high = positions.length - 1;
  while (low <= high) {
    budget.spend();
    const middle = (low + high) >>> 1;
    const candidate = positions[middle];
    if (candidate === position) return true;
    if (candidate !== undefined && candidate < position) low = middle + 1;
    else high = middle - 1;
  }
  return false;
};

export const assetKeyInSortedList = (keys: string[], key: string, budget: AssetReferenceBudget): boolean => {
  let low = 0;
  let high = keys.length - 1;
  while (low <= high) {
    budget.spend();
    const middle = (low + high) >>> 1;
    const candidate = keys[middle];
    if (typeof candidate !== 'string') return false;
    budget.spend(candidate.length + key.length);
    if (candidate === key) return true;
    if (candidate < key) low = middle + 1;
    else high = middle - 1;
  }
  return false;
};

/** Every search comparison, grant and ancestor step consumes the request budget. */
export const pageReferencesAsset = (index: PublishedAssetReferences, key: string, granted: Set<string>, budget: AssetReferenceBudget): boolean => {
  budget.spend();
  if (index.version !== 1 || index.pageIds.length !== index.parents.length) return false;
  let low = 0;
  let high = index.entries.length - 1;
  let entry: PublishedAssetReferences['entries'][number] | undefined;
  while (low <= high) {
    budget.spend();
    const middle = (low + high) >>> 1;
    const candidate = index.entries[middle];
    if (!candidate || typeof candidate[0] !== 'string') return false;
    budget.spend(candidate[0].length + key.length);
    if (candidate[0] === key) {
      entry = candidate;
      break;
    }
    if (candidate[0] < key) low = middle + 1;
    else high = middle - 1;
  }
  if (!entry) return false;
  // Small direct posting lists avoid resolving unrelated grants.
  if (entry[1].length <= granted.size) {
    for (const position of entry[1]) {
      budget.spend();
      const id = index.pageIds[position];
      if (typeof id !== 'string') return false;
      budget.spend(id.length);
      if (granted.has(id)) return true;
    }
    if (!entry[2].length) return false;
  }
  const ancestors = new Set<number>();
  for (const id of granted) {
    budget.spend();
    let left = 0;
    let right = index.pageIds.length - 1;
    let position = -1;
    while (left <= right) {
      budget.spend();
      const middle = (left + right) >>> 1;
      const candidate = index.pageIds[middle];
      if (typeof candidate !== 'string') return false;
      budget.spend(candidate.length + id.length);
      if (candidate === id) {
        position = middle;
        break;
      }
      if (candidate < id) left = middle + 1;
      else right = middle - 1;
    }
    if (position < 0) continue;
    if (contains(entry[1], position, budget)) return true;
    let parent = index.parents[position] ?? -1;
    while (parent >= 0 && !ancestors.has(parent)) {
      budget.spend();
      if (!Number.isInteger(parent) || parent >= index.parents.length) return false;
      ancestors.add(parent);
      if (contains(entry[2], parent, budget)) return true;
      parent = index.parents[parent] ?? -1;
    }
  }
  return false;
};

/** Legacy fallback: one metadata pass per ancestry level, never one pass per grant. */
export const legacyReaderReferencesAsset = (
  snapshot: SiteSnapshot,
  key: string,
  granted: Set<string>,
  budget: AssetReferenceBudget,
  globalSpend: (units: number) => void,
): boolean => {
  const spend = (units: number) => {
    budget.spend(units);
    globalSpend(units);
  };
  let wanted = new Set<string>();
  for (const id of granted) {
    spend(id.length + 1);
    wanted.add(id);
  }
  const seen = new Set<string>();
  let direct = true;
  while (wanted.size) {
    const next = new Set<string>();
    for (const page of snapshot.pages) {
      spend(page.id.length + 1);
      if (!wanted.has(page.id) || seen.has(page.id)) continue;
      seen.add(page.id);
      let found = false;
      for (const work of references(direct ? page : navigationOnly(page), (reference) => {
        if (reference === key) found = true;
      })) {
        spend(work);
        if (found) return true;
      }
      if (page.parentId && !seen.has(page.parentId)) next.add(page.parentId);
    }
    wanted = next;
    direct = false;
  }
  return false;
};
