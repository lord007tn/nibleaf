import { Models } from 'postmark';

/**
 * Transactional emails can contain one-time authentication links. Keep those
 * URLs direct and private instead of rewriting them through tracking domains.
 * Postmark Open Tracking must also be disabled at server level because its
 * server setting overrides the per-message TrackOpens value.
 */
export const postmarkPrivacyOptions = {
  TrackLinks: Models.LinkTrackingOptions.None,
  TrackOpens: false,
} as const;
