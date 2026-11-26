import { describe, expect, it } from 'vitest';
import { confirmAssetBody, presignAssetBody } from './index';

describe('asset upload bodies', () => {
  it('bounds declared lengths consistently at presign and confirmation', () => {
    for (const size of [0, 1.5, 50 * 1024 * 1024 + 1]) {
      expect(presignAssetBody.safeParse({ filename: 'a.png', contentType: 'image/png', size }).success).toBe(false);
      expect(confirmAssetBody.safeParse({ key: 'projects/a/assets/file.png', contentType: 'image/png', size }).success).toBe(false);
    }
    const size = 50 * 1024 * 1024;
    expect(presignAssetBody.parse({ filename: 'a.png', contentType: 'image/png', size }).size).toBe(size);
    expect(confirmAssetBody.parse({ key: 'projects/a/assets/file.png', contentType: 'image/png', size }).size).toBe(size);
  });
});
