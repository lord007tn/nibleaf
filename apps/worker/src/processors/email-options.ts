import { Models } from 'postmark';

/**
 * Transactional emails can contain one-time authentication links. Keep those
 * URLs direct and private instead of rewriting them through tracking domains.
 */
export const postmarkPrivacyOptions = {
  TrackLinks: Models.LinkTrackingOptions.None,
  TrackOpens: false,
} as const;
