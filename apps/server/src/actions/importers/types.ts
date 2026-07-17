/**
 * Content-importer framework: one-way imports from other documentation
 * systems into a project's pages. Each source implements `ImporterSource`
 * and registers itself in `./index.ts`; new systems (GitBook, Docusaurus,
 * ReadMe, …) slot in by adding an id here and a module next to the others.
 *
 * This module is intentionally pure (no prisma / fetch / `@/…` imports) so
 * mapping logic and unit tests can share it without a database.
 */

/** Known import sources. Extend this union when adding a new importer. */
export type ImporterSourceId = 'mintlify' | 'ghost' | 'gitbook' | 'docusaurus' | 'readme';

/** What every importer reports back — shown to the user as-is. */
export interface ImportSummary {
  imported: number;
  updated: number;
  skipped: number;
  /** Remote media copied into project storage by importers that support it. */
  assetsImported?: number;
  /** Remote media left at its source URL because it could not be migrated. */
  assetsSkipped?: number;
  /** Non-fatal issues (unmatched nav entries, unparseable files, config keys kept). */
  warnings: string[];
}

/** Everything an importer needs to run: the tenant scope plus its validated input. */
export interface ImporterContext<TInput = unknown> {
  organizationId: string;
  projectId: string;
  input: TInput;
}

/** A single import source (Mintlify, Ghost, …). */
export interface ImporterSource<TInput = unknown> {
  id: ImporterSourceId;
  run(ctx: ImporterContext<TInput>): Promise<ImportSummary>;
}

export const emptySummary = (): ImportSummary => ({ imported: 0, updated: 0, skipped: 0, warnings: [] });
