import type { ReactNode } from 'react';
import { LocalizedProductProviders } from '@/components/localized-product-providers';

/**
 * On phones, dashboard toasts show at the top of the screen instead of the
 * bottom, where the page's save bar (SaveRegion) floats or docks: a failed save's
 * error toast covered Save and Discard. Sonner's own mobile layout (≤600px) is
 * kept; only its bottom anchor and stacking direction flip, as its top
 * position does it. Desktop, auth and reader toasts are untouched: the rules
 * only match the toast host inside this wrapper.
 */
const PHONE_TOASTS_AT_TOP = `@media (max-width: 600px) {
[data-dashboard-toasts] [data-sonner-toaster][data-y-position="bottom"] { top: calc(var(--mobile-offset-top) + env(safe-area-inset-top, 0px)); bottom: auto; }
[data-dashboard-toasts] [data-sonner-toast][data-y-position="bottom"] { top: 0; bottom: auto; --lift: 1; }
}`;

/** Dashboard and auth providers kept out of public marketing and reader chunks. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <div className="contents" data-dashboard-toasts="">
      <style>{PHONE_TOASTS_AT_TOP}</style>
      <LocalizedProductProviders>{children}</LocalizedProductProviders>
    </div>
  );
}
