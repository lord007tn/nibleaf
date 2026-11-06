/** Core Web Vitals the dashboard rates, with Google's published thresholds. */
export type VitalMetric = 'lcp' | 'inp' | 'cls';
export type VitalRating = 'good' | 'needs_improvement' | 'poor';

const THRESHOLDS: Record<VitalMetric, { good: number; poor: number }> = {
  /** Largest Contentful Paint, ms. */
  lcp: { good: 2500, poor: 4000 },
  /** Interaction to Next Paint, ms. */
  inp: { good: 200, poor: 500 },
  /** Cumulative Layout Shift, unitless. */
  cls: { good: 0.1, poor: 0.25 },
};

/** The rating of a p75 value, or null when it is unknown. Boundaries are inclusive of "good" like Google's tooling. */
export function rateVital(metric: VitalMetric, value: number | null): VitalRating | null {
  if (value === null) return null;
  const { good, poor } = THRESHOLDS[metric];
  if (value <= good) return 'good';
  if (value <= poor) return 'needs_improvement';
  return 'poor';
}
