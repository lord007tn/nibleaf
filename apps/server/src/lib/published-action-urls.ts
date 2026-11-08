import type { SiteSnapshot } from '@nibleaf/shared/site';
import { supportActionUrlSchema, webActionUrlSchema } from '@nibleaf/validators';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** Sanitize stored action links without changing the cached deployment snapshot. */
const sanitizeConfig = (config: object | null): Record<string, unknown> | null => {
  if (!config) return config;
  const result: Record<string, unknown> = { ...config };
  if (record(result.addons)) {
    const addons = { ...result.addons };
    for (const field of ['editUrl', 'issueUrl']) {
      const parsed = webActionUrlSchema.safeParse(addons[field]);
      if (!parsed.success) delete addons[field];
    }
    result.addons = addons;
  }
  if (record(result.search)) {
    const search = { ...result.search };
    if (!supportActionUrlSchema.safeParse(search.aiSupportUrl).success) delete search.aiSupportUrl;
    result.search = search;
  }
  return result;
};

export const sanitizePublishedSiteActionUrls = (snapshot: SiteSnapshot): SiteSnapshot => ({
  ...snapshot,
  project: {
    ...snapshot.project,
    config: sanitizeConfig(snapshot.project.config),
    languages: snapshot.project.languages.map((language) => ({ ...language, config: sanitizeConfig(language.config) })),
  },
});
