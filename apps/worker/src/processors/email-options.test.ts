import { Models } from 'postmark';
import { describe, expect, it } from 'vitest';
import { postmarkPrivacyOptions } from './email-options';

describe('postmarkPrivacyOptions', () => {
  it('keeps transactional and authentication links direct', () => {
    expect(postmarkPrivacyOptions).toEqual({
      TrackLinks: Models.LinkTrackingOptions.None,
      TrackOpens: false,
    });
  });
});
