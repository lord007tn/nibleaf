export type CalloutType = 'note' | 'info' | 'tip' | 'check' | 'warning' | 'danger';

/** Normalize an admonition/callout keyword to one of our supported types.
 *  Shared by the reader and static exports so both accept the same markers. */
export const normalizeType = (raw?: string): CalloutType => {
  const t = (raw ?? 'note').toLowerCase();
  if (t === 'caution') return 'danger';
  if (t === 'important') return 'info';
  if (['note', 'info', 'tip', 'check', 'warning', 'danger'].includes(t)) return t as CalloutType;
  return 'note';
};
