/**
 * Cloud Beta plan limits — the single source of truth for every "used / limit"
 * meter in the Usage tab and the numbers quoted in the Plan section.
 *
 * The product is a free beta with no billing code: these are generous soft
 * caps, clearly labeled Beta in the UI and not enforced anywhere server-side.
 * `null` means the metric is surfaced but unmetered.
 */
export const BETA_LIMITS = {
  pages: 500,
  languages: 25,
  members: 20,
  /** Publishes per calendar month. */
  deploymentsPerMonth: 200,
  /** Public pageviews per rolling 30 days. */
  pageviews30d: 100_000,
  /** In-docs searches are not metered during the beta. */
  searches30d: null,
  /** Uploaded asset storage: 1 GiB. */
  storageBytes: 1024 * 1024 * 1024,
} as const;
