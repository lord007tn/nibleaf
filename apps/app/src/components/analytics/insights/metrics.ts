/** How a metric is measured, which decides formatting and how its change is expressed. */
export type MetricKind = 'count' | 'rate' | 'duration' | 'ms' | 'position';

/** Whether a rise is good news. A higher zero-result rate or a slower page is bad. */
export type MetricPolarity = 'higher_is_better' | 'lower_is_better' | 'neutral';

export interface Compared {
  value: number | null;
  previous: number | null;
}

export type Delta =
  /** Relative change in percent (counts, durations). */
  | { mode: 'percent'; amount: number; direction: 'up' | 'down' | 'flat' }
  /** Absolute change in percentage points (rates are 0..1 fractions). */
  | { mode: 'points'; amount: number; direction: 'up' | 'down' | 'flat' }
  /** Nothing in the previous period, something now. */
  | { mode: 'new'; amount: 0; direction: 'up' };

const FLAT_PERCENT = 0.5;
const FLAT_POINTS = 0.05;

/** The change versus the previous period, or null when either side is unknown. */
export function compareDelta(compared: Compared, kind: MetricKind): Delta | null {
  const { value, previous } = compared;
  if (value === null || previous === null) return null;
  if (kind === 'rate') {
    const amount = (value - previous) * 100;
    return { mode: 'points', amount, direction: Math.abs(amount) < FLAT_POINTS ? 'flat' : amount > 0 ? 'up' : 'down' };
  }
  if (previous === 0) return value === 0 ? { mode: 'percent', amount: 0, direction: 'flat' } : { mode: 'new', amount: 0, direction: 'up' };
  const amount = ((value - previous) / Math.abs(previous)) * 100;
  return { mode: 'percent', amount, direction: Math.abs(amount) < FLAT_PERCENT ? 'flat' : amount > 0 ? 'up' : 'down' };
}

/** Good / bad / neutral for a change, so colour follows meaning rather than the arrow. */
export function deltaTone(delta: Delta, polarity: MetricPolarity): 'good' | 'bad' | 'neutral' {
  if (delta.direction === 'flat' || polarity === 'neutral') return 'neutral';
  const rising = delta.direction === 'up';
  return rising === (polarity === 'higher_is_better') ? 'good' : 'bad';
}

/** Relative change of a plain count pair, for table cells ("views vs previous"). */
export function countDelta(value: number, previous: number | null): Delta | null {
  return compareDelta({ value, previous }, 'count');
}
