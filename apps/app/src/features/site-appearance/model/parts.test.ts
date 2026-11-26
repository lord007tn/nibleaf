import { describe, expect, it } from 'vitest';
import { appearancePart } from './parts';

// B5: Appearance was seven tabs; a link to one opens the one page at the part that holds it now.
describe('appearancePart', () => {
  it.each([
    ['branding', 'brand'],
    ['themes', 'theme'],
    ['styling', 'theme'],
    ['typography', 'typography'],
    ['navbar', 'chrome'],
    ['footer', 'chrome'],
    ['banner', 'chrome'],
    ['brand', 'brand'],
    ['theme', 'theme'],
    ['chrome', 'chrome'],
  ] as const)('opens %s at the %s part', (link, part) => {
    expect(appearancePart(link)).toBe(part);
  });
});
