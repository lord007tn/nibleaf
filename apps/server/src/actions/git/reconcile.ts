export interface ReconcileResult {
  conflict: boolean;
  /** null is a deliberate deletion, not an empty file. */
  content: string | null;
  source: 'unchanged' | 'ours' | 'theirs' | 'same-change' | 'conflict';
}

export interface ConflictSnapshot {
  baseContent: string | null;
  oursContent: string | null;
  theirsContent: string | null;
}

export type RepositoryFileOwnership = 'PLATFORM' | 'SHARED' | 'CUSTOMER';

export const repositoryOurs = (
  ownership: RepositoryFileOwnership,
  state: { baseContent: string | null; baseExists: boolean } | undefined,
  generated: string | null,
): string | null => (ownership === 'CUSTOMER' && state ? (state.baseExists ? state.baseContent : null) : generated);

/** A previously resolved conflict is only reusable while all three inputs are
 * identical. This prevents a retry from applying a stale choice over edits
 * that arrived after the author made that choice. */
export const conflictSnapshotMatches = (
  snapshot: ConflictSnapshot,
  current: { base: string | null; ours: string | null; theirs: string | null },
): boolean => snapshot.baseContent === current.base && snapshot.oursContent === current.ours && snapshot.theirsContent === current.theirs;

/** Pure three-way file reconciliation. Neither side wins when both changed
 * differently; callers must persist base/ours/theirs and require a resolution. */
export const reconcileFile = (base: string | null, ours: string | null, theirs: string | null): ReconcileResult => {
  if (ours === theirs) return { conflict: false, content: ours, source: ours === base ? 'unchanged' : 'same-change' };
  if (ours === base) return { conflict: false, content: theirs, source: 'theirs' };
  if (theirs === base) return { conflict: false, content: ours, source: 'ours' };
  return { conflict: true, content: null, source: 'conflict' };
};

/** Ownership-aware reconciliation layered on the existing base/ours/theirs
 * primitive. Customer code follows Git after the initial scaffold; generated
 * platform files fail closed when edited upstream; shared MDX stays three-way. */
export const reconcileOwnedFile = (
  ownership: RepositoryFileOwnership,
  base: string | null,
  ours: string | null,
  theirs: string | null,
): ReconcileResult => {
  if (ownership === 'CUSTOMER') {
    if (base === null && theirs === null && ours !== null) return { conflict: false, content: ours, source: 'ours' };
    return { conflict: false, content: theirs, source: theirs === base ? 'unchanged' : 'theirs' };
  }
  if (ownership === 'PLATFORM' && theirs !== base && theirs !== ours) {
    return { conflict: true, content: null, source: 'conflict' };
  }
  return reconcileFile(base, ours, theirs);
};
