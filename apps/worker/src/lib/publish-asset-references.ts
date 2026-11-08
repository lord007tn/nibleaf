import { AssetBuildTokens, assetReferenceIndexBuild, type PublishedAssetReferences } from '@nibleaf/shared/asset-references';
import type { SiteSnapshot } from '@nibleaf/shared/site';

// Shared by all publish jobs in this process; each project has a smaller share of the same build capacity.
const globalBuild = new AssetBuildTokens(64 * 1024 * 1024, 4 * 1024 * 1024);
const projects = new Map<string, { tokens: AssetBuildTokens; at: number }>();

export const buildDeploymentAssetReferences = async (snapshot: SiteSnapshot): Promise<PublishedAssetReferences> => {
  const projectId = snapshot.project.id;
  let quota = projects.get(projectId);
  if (!quota) {
    if (projects.size >= 1024) {
      const oldest = [...projects].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) projects.delete(oldest[0]);
    }
    quota = { tokens: new AssetBuildTokens(16 * 1024 * 1024, 1024 * 1024), at: Date.now() };
    projects.set(projectId, quota);
  }
  quota.at = Date.now();
  const build = assetReferenceIndexBuild(snapshot);
  let step = build.next();
  while (!step.done) {
    let units = step.value;
    while (units > 0) {
      const chunk = Math.min(units, 64 * 1024);
      // Reserve project tokens first; waiting never holds a database connection or a request callback.
      while (!quota.tokens.take(chunk)) await new Promise((resolve) => setTimeout(resolve, 64));
      while (!globalBuild.take(chunk)) await new Promise((resolve) => setTimeout(resolve, 16));
      units -= chunk;
    }
    step = build.next();
  }
  return step.value;
};
