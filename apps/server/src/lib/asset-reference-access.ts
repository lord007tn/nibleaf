import { createHash } from 'node:crypto';
import {
  AssetBuildTokens,
  AssetReferenceBudget,
  AssetReferenceBudgetExceeded,
  assetKeyInSortedList,
  buildAssetReferencesSync,
  legacyReaderReferencesAsset,
  MAX_PUBLISHED_ASSET_INDEX_BYTES,
  type PublishedAssetReferences,
  pageReferencesAsset,
  serializedAssetReferenceValue,
} from '@nibleaf/shared/asset-references';
import type { SiteSnapshot, SnapshotProject } from '@nibleaf/shared/site';
import { LruCache } from './lru';

const LEGACY_MAX_BYTES = 4 * 1024 * 1024;
const LEGACY_MAX_PAGES = 10_000;
const REQUEST_WORK = 4_500_000;
const BUILD_WORK = 8 * 1024 * 1024;

type Entry = { projectId: string; value: PublishedAssetReferences; weight: number };

/** Actual estimated bytes, with independent project quotas. Only capacity eviction starts a rebuild cooldown. */
class ReferencePool {
  private readonly entries = new Map<string, Entry>();
  private readonly used = new Map<string, number>();
  private readonly projects = new Map<string, Set<string>>();
  private readonly lru: LruCache<string, Entry>;
  constructor(
    max: number,
    private readonly perProject: number,
    private readonly evicted: (key: string) => void,
  ) {
    this.lru = new LruCache(
      max,
      (entry) => entry.weight,
      (key, entry) => this.removed(key, entry),
    );
  }
  private removed(key: string, entry: Entry): void {
    this.entries.delete(key);
    const project = this.projects.get(entry.projectId);
    project?.delete(key);
    if (!project?.size) this.projects.delete(entry.projectId);
    this.used.set(entry.projectId, (this.used.get(entry.projectId) ?? 0) - entry.weight);
    if (this.used.get(entry.projectId) === 0) this.used.delete(entry.projectId);
    this.evicted(key);
  }
  get(key: string): PublishedAssetReferences | undefined {
    const entry = this.lru.get(key);
    if (entry) {
      const project = this.projects.get(entry.projectId);
      project?.delete(key);
      project?.add(key);
    }
    return entry?.value;
  }
  put(key: string, projectId: string, value: PublishedAssetReferences): boolean {
    if (value.weight > this.perProject || !this.lru.canAdmit(value.weight)) return false;
    const previous = this.entries.get(key);
    if (previous) {
      this.lru.delete(key);
      this.entries.delete(key);
      this.projects.get(projectId)?.delete(key);
      this.used.set(projectId, (this.used.get(projectId) ?? 0) - previous.weight);
    }
    while ((this.used.get(projectId) ?? 0) + value.weight > this.perProject) {
      const oldest = this.projects.get(projectId)?.values().next().value;
      if (!oldest) return false;
      const entry = this.entries.get(oldest);
      this.lru.delete(oldest);
      if (entry) this.removed(oldest, entry);
    }
    const entry = { projectId, value, weight: value.weight };
    let project = this.projects.get(projectId);
    if (!project) {
      project = new Set();
      this.projects.set(projectId, project);
    }
    project.add(key);
    this.entries.set(key, entry);
    this.used.set(projectId, (this.used.get(projectId) ?? 0) + value.weight);
    return this.lru.set(key, entry);
  }
}

export class AssetReferenceAccess {
  private readonly pool: ReferencePool;
  private readonly evictedAt = new LruCache<string, number>(4096);
  private readonly inFlight = new Map<string, Promise<PublishedAssetReferences | null>>();
  private activeJobs = 0;
  private readonly stamps = new WeakMap<object, Promise<string | null>>();
  private readonly projectTokens = new LruCache<string, AssetBuildTokens>(1024);
  private readonly readTokens: AssetBuildTokens;
  private readonly buildTokens: AssetBuildTokens;
  constructor(
    private readonly options: {
      clock?: () => number;
      cacheBytes?: number;
      projectBytes?: number;
      buildCapacity?: number;
      buildPerSecond?: number;
      readCapacity?: number;
      schedule?: (work: () => PublishedAssetReferences) => Promise<PublishedAssetReferences>;
    } = {},
  ) {
    const clock = options.clock ?? Date.now;
    this.pool = new ReferencePool(options.cacheBytes ?? 96 * 1024 * 1024, options.projectBytes ?? 32 * 1024 * 1024, (key) =>
      this.evictedAt.set(key, clock()),
    );
    this.buildTokens = new AssetBuildTokens(options.buildCapacity ?? 32 * 1024 * 1024, options.buildPerSecond ?? 2 * 1024 * 1024, clock);
    this.readTokens = new AssetBuildTokens(options.readCapacity ?? 64 * 1024 * 1024, 8 * 1024 * 1024, clock);
  }
  private spendBuild(projectId: string, units: number): void {
    let project = this.projectTokens.get(projectId);
    if (!project) {
      project = new AssetBuildTokens(BUILD_WORK, 512 * 1024, this.options.clock ?? Date.now);
      this.projectTokens.set(projectId, project);
    }
    if (!project.take(units) || !this.buildTokens.take(units)) throw new AssetReferenceBudgetExceeded();
  }
  async stamp(projectId: string, value: object): Promise<string | null> {
    const cached = this.stamps.get(value);
    if (cached) return cached;
    if (this.activeJobs >= 16) return null;
    this.activeJobs++;
    const task = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() =>
        createHash('sha256')
          .update(serializedAssetReferenceValue(value, (units) => this.spendBuild(projectId, units)))
          .digest('hex'),
      )
      .catch(() => null)
      .then((result) => {
        if (result === null && this.stamps.get(value) === task) this.stamps.delete(value);
        return result;
      })
      .finally(() => {
        this.activeJobs--;
      });
    this.stamps.set(value, task);
    return task;
  }
  reserveRead(bytes: number): boolean {
    return this.readTokens.take(bytes);
  }
  async load(
    projectId: string,
    id: string,
    bytes: number,
    loader: () => Promise<PublishedAssetReferences | null>,
  ): Promise<PublishedAssetReferences | null> {
    const key = `stored:${id}`;
    const cached = this.pool.get(key);
    if (cached) return cached;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    if (bytes <= 0 || bytes > MAX_PUBLISHED_ASSET_INDEX_BYTES || this.inFlight.size >= 16 || !this.readTokens.take(bytes)) return null;
    const task = loader()
      .then((index) => {
        if (index?.version !== 1 || index.projectId !== projectId || index.weight !== bytes) return null;
        this.pool.put(key, projectId, index);
        return index;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }
  private async build(key: string, projectId: string, source: () => SiteSnapshot, cooldown: boolean): Promise<PublishedAssetReferences | null> {
    const cached = this.pool.get(key);
    if (cached) return cached;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const evicted = this.evictedAt.get(key);
    if (cooldown && evicted !== undefined && (this.options.clock ?? Date.now)() - evicted < 60_000) return null;
    if (this.activeJobs >= 16) return null;
    this.activeJobs++;
    const work = () => buildAssetReferencesSync(source(), (units) => this.spendBuild(projectId, units), BUILD_WORK);
    // Page bodies are processed only here, on the bounded background build queue, never by stored-index lookups.
    const task = (this.options.schedule ? this.options.schedule(work) : new Promise<void>((resolve) => setImmediate(resolve)).then(work))
      .then((index) => {
        this.pool.put(key, projectId, index);
        return index;
      })
      .catch(() => null)
      .finally(() => {
        this.inFlight.delete(key);
        this.activeJobs--;
      });
    this.inFlight.set(key, task);
    return task;
  }
  async allows(input: {
    projectId: string;
    deploymentId: string;
    key: string;
    grants: Set<string>;
    chromeStamp: string | null;
    index: PublishedAssetReferences | null;
    legacy?: SiteSnapshot;
    chrome: () => SnapshotProject;
  }): Promise<boolean> {
    const budget = new AssetReferenceBudget(REQUEST_WORK);
    try {
      budget.spend();
      let index = input.index;
      if (!index) {
        if (!input.legacy || input.legacy.pages.length > LEGACY_MAX_PAGES) return false;
        index = await this.build(`legacy:${input.deploymentId}`, input.projectId, () => input.legacy as SiteSnapshot, true);
        if (!index && legacyReaderReferencesAsset(input.legacy, input.key, input.grants, budget, (units) => this.spendBuild(input.projectId, units)))
          return true;
      }
      if (index && index.projectId !== input.projectId) return false;
      if (index && pageReferencesAsset(index, input.key, input.grants, budget)) return true;
      if (!input.chromeStamp) return false;
      // Chrome is versioned independently; compact rebuilds are admitted immediately rather than denied by a body-index cooldown.
      const chrome = await this.build(
        `chrome:${input.deploymentId}:${input.chromeStamp}`,
        input.projectId,
        () => ({
          project: input.chrome(),
          pages: [],
          generatedAt: '',
        }),
        false,
      );
      return chrome ? assetKeyInSortedList(chrome.chromeKeys, input.key, budget) : false;
    } catch {
      return false;
    }
  }
  canReadLegacy(bytes: number | null | undefined, pages: number | null | undefined): boolean {
    return (
      bytes !== null &&
      bytes !== undefined &&
      bytes > 0 &&
      bytes <= LEGACY_MAX_BYTES &&
      pages !== null &&
      pages !== undefined &&
      pages <= LEGACY_MAX_PAGES
    );
  }
}
