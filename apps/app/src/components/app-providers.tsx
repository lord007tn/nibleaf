import englishMessages from 'virtual:nibleaf-messages/en/app';
import type { ReactNode } from 'react';
import { LocalizedProductProviders } from '@/components/localized-product-providers';
import { catalogLoader } from '@/lib/i18n/catalog-loaders';

const loadMessages = catalogLoader('app');

/** Dashboard and auth providers kept out of public marketing and reader chunks. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <LocalizedProductProviders englishMessages={englishMessages} loadMessages={loadMessages}>
      {children}
    </LocalizedProductProviders>
  );
}
