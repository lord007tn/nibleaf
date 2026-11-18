import type { Locale } from './locales';
import type { MessageFn } from './message-types';
import * as messages from './paraglide/messages.js';

// The server keeps Paraglide's synchronous, request-local resolution. This
// module is replaced by the browser export before client bundling.
export const dashboardMessage = (id: string, _locale: Locale): MessageFn | undefined =>
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: this compatibility path intentionally keeps every locale synchronous on the server and admin.
  messages[id as keyof typeof messages] as unknown as MessageFn | undefined;

export async function prepareDashboardLocale(_locale: Locale): Promise<boolean> {
  return true;
}

export const dashboardLocaleFailure = (_locale: Locale): unknown => undefined;

export function configureDashboardLocaleLoading(_wrapper: (load: () => Promise<unknown>) => Promise<unknown>, _active?: () => boolean): void {
  // Server/admin translation never needs client download configuration.
}
