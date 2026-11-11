import { describe, expect, it } from 'vitest';
import { constantGrowthLimit, growthMs, linearGrowthLimit } from './growth';

/** Work proportional to the input's length. */
const linear = (input: string) => {
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) sum += input.charCodeAt(index);
  return sum;
};
/** Work proportional to the square of the input's length. */
const quadratic = (input: string) => {
  let sum = 0;
  for (let outer = 0; outer < input.length; outer += 1) for (let inner = outer; inner < input.length; inner += 1) sum += input.charCodeAt(inner);
  return sum;
};
/** Work that ignores the input's length. */
const constant = (input: string) => input.charCodeAt(0);

// The bounds have to catch what they are for, on this runner, or every test
// using them could pass a regression. Margins are wide (minMs) so these never flake.
describe('growth bounds', () => {
  it('pass linear work and fail quadratic work', () => {
    const [linearSmall, linearLarge] = growthMs(linear, 'a'.repeat(50_000), 'a'.repeat(200_000));
    expect(linearLarge).toBeLessThanOrEqual(linearGrowthLimit(linearSmall));
    const [quadraticSmall, quadraticLarge] = growthMs(quadratic, 'a'.repeat(400), 'a'.repeat(1600), { minMs: 10 });
    expect(quadraticLarge).toBeGreaterThan(linearGrowthLimit(quadraticSmall));
  });

  it('pass constant work and fail linear work against the constant bound', () => {
    const [constantSmall, constantLarge] = growthMs(constant, 'a'.repeat(50_000), 'a'.repeat(200_000), { minMs: 12 });
    expect(constantLarge).toBeLessThanOrEqual(constantGrowthLimit(constantSmall));
    const [linearSmall, linearLarge] = growthMs(linear, 'a'.repeat(50_000), 'a'.repeat(200_000), { minMs: 30 });
    expect(linearLarge).toBeGreaterThan(constantGrowthLimit(linearSmall));
  });
});
