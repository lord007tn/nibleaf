import { defaultLanguage, publicLanguages, type SiteSnapshot } from '@nibleaf/shared/site';
import { searchConfigurationSchema } from '@nibleaf/validators';
import { z } from 'zod';

const configRecordSchema = z.record(z.string(), z.unknown()).catch({});

export const resolvePublishedSearchRequest = (config: unknown, requested: { language?: string; version?: string; limit?: number }) => {
  const parsed = searchConfigurationSchema.safeParse(configRecordSchema.parse(config).search);
  const configuration = parsed.success ? parsed.data : searchConfigurationSchema.parse({});
  return {
    configuration,
    // Selector visibility is presentation-only. The active page context is
    // still server-validated below the action boundary and must survive when a
    // selector is hidden, otherwise localized/versioned pages fall back to the
    // project defaults.
    language: requested.language,
    version: requested.version,
    limit: Math.min(requested.limit ?? configuration.maxResults, configuration.maxResults),
  };
};

/** Resolve the caller-supplied active page context against the immutable
 * published snapshot. Both keyword and answer actions use this boundary so a
 * hidden selector cannot change tenant/language/version scope. */
export const resolvePublishedSearchContext = (snapshot: SiteSnapshot, requested: { language?: string; version?: string; limit?: number }) => {
  const request = resolvePublishedSearchRequest(snapshot.project.config, requested);
  const language =
    publicLanguages(snapshot.project.languages).find((candidate) => candidate.code === request.language)?.code ??
    defaultLanguage(snapshot.project).code;
  const defaultVersions = snapshot.project.versions.filter((candidate) => candidate.isDefault);
  if (defaultVersions.length !== 1 || !defaultVersions[0]) {
    throw new Error(`Snapshot project ${snapshot.project.id} must have exactly one default version.`);
  }
  const version = snapshot.project.versions.find((candidate) => candidate.slug === request.version) ?? defaultVersions[0];
  return { configuration: request.configuration, language, version, limit: request.limit };
};
