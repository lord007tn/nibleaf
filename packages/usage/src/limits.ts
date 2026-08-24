import type { MeterKey } from './contract';

export type UsageAvailability = 'complete' | 'partial' | 'unavailable';
export type LimitBehavior = 'observe' | 'warn' | 'block';
export type LimitState = 'available' | 'approaching' | 'exceeded' | 'unknown' | 'unlimited';
export type LimitEnforcement = 'advisory' | 'enforced';

export interface MeterReading {
  meterKey: MeterKey | 'editor_seat' | 'asset_storage_byte' | 'custom_domain' | 'published_page';
  quantity: string | null;
  limit: string | null;
  availability: UsageAvailability;
  behavior: LimitBehavior;
  enforcement: LimitEnforcement;
  periodStart: string | null;
  periodEndExclusive: string | null;
}

export const evaluateLimit = (reading: MeterReading, warningRatio = 0.8) => {
  if (reading.quantity === null || reading.availability === 'unavailable') return { state: 'unknown' as const, ratio: null, allowed: true };
  if (reading.limit === null) return { state: 'unlimited' as const, ratio: null, allowed: true };
  const quantity = BigInt(reading.quantity);
  const limit = BigInt(reading.limit);
  const ratio = limit === 0n ? null : Number((quantity * 10_000n) / limit) / 10_000;
  const state: LimitState =
    limit === 0n && quantity > 0n ? 'exceeded' : (ratio ?? 0) >= 1 ? 'exceeded' : (ratio ?? 0) >= warningRatio ? 'approaching' : 'available';
  return { state, ratio, allowed: reading.enforcement !== 'enforced' || state !== 'exceeded' || reading.behavior !== 'block' };
};
