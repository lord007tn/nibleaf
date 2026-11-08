import { MAX_ASSET_UPLOAD_BYTES } from '@nibleaf/shared/constants';
import { MAX_PRESIGNED_UPLOAD_BYTES } from '@nibleaf/storage';
import { describe, expect, it } from 'vitest';

describe('upload size limits', () => {
  it('signs uploads with the same maximum the validators and confirmation enforce', () => {
    expect(MAX_PRESIGNED_UPLOAD_BYTES).toBe(MAX_ASSET_UPLOAD_BYTES);
  });
});
