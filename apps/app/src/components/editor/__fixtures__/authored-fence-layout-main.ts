import { expect } from 'vitest';
import layout from './authored-fence-layout-main.json';

/** Check the exact new bytes on named rows before comparing the historical layout. */
export function priorFenceLayoutDigest(suite: keyof typeof layout.suites, index: number, actual: string): string {
  const rows: Readonly<Record<string, readonly string[]>> = layout.suites[suite];
  const row = rows[index];
  if (!row) return actual;
  const [previous, expected] = row;
  expect(actual, `authored fence layout for ${suite} page ${index}`).toBe(expected);
  return previous as string;
}
