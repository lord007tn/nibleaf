import { randomBytes } from 'node:crypto';
import { isProjectHostnameAllowed, projectSystemHosts } from '@nibleaf/shared/project-hostname';

/** The address the sign-up starter site asks for first. It was `docs` until
 *  `docs` became a reserved system hostname, which left every new instance's
 *  first site with an address its own settings form refused to save. */
export const STARTER_SLUG_BASE = 'documentation';

/** The addresses tried for the starter site, in order: the base, a few short
 *  numbered ones, then random suffixes. None is reserved, either by the fixed
 *  list or by this deployment's configured hosts (`configuredHosts`). */
export function starterSlugCandidates(
  configuredHosts: ReadonlyArray<string | undefined>,
  randomSuffix: () => string = () => randomBytes(4).toString('hex'),
): string[] {
  const candidates = [
    STARTER_SLUG_BASE,
    ...Array.from({ length: 8 }, (_, index) => `${STARTER_SLUG_BASE}-${index + 2}`),
    ...Array.from({ length: 4 }, () => `${STARTER_SLUG_BASE}-${randomSuffix()}`),
  ];
  return candidates.filter((slug) => isProjectHostnameAllowed(slug, configuredHosts));
}

/** The last-resort starter address, for when every candidate was taken or a
 *  unique-constraint race used them up: a timestamp, then random suffixes,
 *  until one is allowed on this deployment. */
export function starterFallbackSlug(
  configuredHosts: ReadonlyArray<string | undefined> = projectSystemHosts(process.env),
  now: () => number = Date.now,
  randomSuffix: () => string = () => randomBytes(4).toString('hex'),
): string {
  let candidate = `${STARTER_SLUG_BASE}-${now().toString(36)}`;
  while (!isProjectHostnameAllowed(candidate, configuredHosts)) candidate = `${STARTER_SLUG_BASE}-${now().toString(36)}-${randomSuffix()}`;
  return candidate;
}

/** The first free starter address. `isTaken` is one global lookup per call;
 *  the caller still retries on the unique constraint, since this only pre-checks. */
export async function pickStarterSlug(
  isTaken: (slug: string) => Promise<boolean>,
  configuredHosts: ReadonlyArray<string | undefined> = projectSystemHosts(process.env),
): Promise<string> {
  for (const candidate of starterSlugCandidates(configuredHosts)) {
    if (!(await isTaken(candidate))) return candidate;
  }
  return starterFallbackSlug(configuredHosts);
}
