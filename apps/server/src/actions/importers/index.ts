import { ghostImporter } from './ghost';
import { mintlifyImporter } from './mintlify';
import type { ImporterSource, ImporterSourceId } from './types';

export type { ImporterContext, ImporterSource, ImporterSourceId, ImportSummary } from './types';

/**
 * Registry of available import sources, keyed by id. Adding a new system
 * (GitBook, Docusaurus, ReadMe, …) means: extend `ImporterSourceId`, implement
 * an `ImporterSource` module next to the existing ones, and list it here —
 * handlers reach their source through this record so inputs stay fully typed.
 */
export const importers = {
  mintlify: mintlifyImporter,
  ghost: ghostImporter,
} as const satisfies Partial<Record<ImporterSourceId, ImporterSource<never>>>;
