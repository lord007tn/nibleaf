import englishMessages from 'virtual:nibleaf-messages/en/app';
import type { ReactNode } from 'react';
import { LocalizedProductProviders } from '@/components/localized-product-providers';

const loadArabicMessages = () => import('virtual:nibleaf-messages/ar/app');

/** Dashboard and auth providers kept out of public marketing and reader chunks. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <LocalizedProductProviders englishMessages={englishMessages} loadArabicMessages={loadArabicMessages}>
      {children}
    </LocalizedProductProviders>
  );
}
