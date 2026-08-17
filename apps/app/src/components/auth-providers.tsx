import englishMessages from 'virtual:nibleaf-messages/en/auth';
import type { ReactNode } from 'react';
import { LocalizedProductProviders } from '@/components/localized-product-providers';

const loadArabicMessages = () => import('virtual:nibleaf-messages/ar/auth');

/** Auth/common namespace only; editor, analytics, and admin copy remain in the
 * authenticated application chunk. */
export function AuthProviders({ children }: { children: ReactNode }) {
  return (
    <LocalizedProductProviders englishMessages={englishMessages} loadArabicMessages={loadArabicMessages}>
      {children}
    </LocalizedProductProviders>
  );
}
