import { describe, expect, it } from 'vitest';
import { previewsDraft } from './preview-target';

describe('previewsDraft', () => {
  it('previews the draft by default, and when preview deployments are on', () => {
    expect(previewsDraft({ config: null })).toBe(true);
    expect(previewsDraft({ config: {} })).toBe(true);
    expect(previewsDraft({ config: { addons: { previewDeployments: true } } })).toBe(true);
  });

  it('goes to the live site when preview deployments are off, or before the site loads', () => {
    expect(previewsDraft({ config: { addons: { previewDeployments: false } } })).toBe(false);
    expect(previewsDraft(undefined)).toBe(false);
  });
});
