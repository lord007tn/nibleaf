/**
 * The browser tab's title for a dashboard page, most specific first:
 * "Members · Ada's workspace · Nibleaf", "General · Documentation · Nibleaf".
 * Tabs, history and screen-reader page announcements can then tell pages
 * apart (P2-DASH-009, WCAG 2.4.2). Empty parts (a name still loading) are left out.
 */
export const pageTitle = (...parts: ReadonlyArray<string | null | undefined>): string =>
  [...parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part)), 'Nibleaf'].join(' · ');
