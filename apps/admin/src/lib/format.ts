/** Short human date for admin tables, e.g. "Jul 2, 2026". */
export const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
