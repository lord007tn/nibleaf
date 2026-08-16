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
