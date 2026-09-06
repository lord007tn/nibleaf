/** Keep route eligibility independent of the consent UI and its domain parser. */
export function marketingAnalyticsEnabled(pathname: string, siteProjectId?: string): boolean {
  if (siteProjectId) return false;
  return !['/app', '/sign-in', '/forgot-password', '/reset-password', '/verify-email', '/accept-invite', '/git-preview'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
