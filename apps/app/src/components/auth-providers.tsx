import englishMessages from 'virtual:nibleaf-messages/en/auth';
import { useRouterState } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { LocalizedProductProviders } from '@/components/localized-product-providers';
import { authDocumentTitle } from '@/lib/auth-document-title';
import { useT } from '@/lib/i18n';
import { catalogLoader } from '@/lib/i18n/catalog-loaders';

const loadMessages = catalogLoader('auth');

function AuthDocumentTitle() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const t = useT();

  useEffect(() => {
    const title = authDocumentTitle(pathname, t);
    if (title) document.title = title;
  }, [pathname, t]);

  return null;
}

/** Auth/common namespace only; editor, analytics, and admin copy remain in the
 * authenticated application chunk. */
export function AuthProviders({ children }: { children: ReactNode }) {
  return (
    <LocalizedProductProviders englishMessages={englishMessages} loadMessages={loadMessages}>
      <AuthDocumentTitle />
      {children}
    </LocalizedProductProviders>
  );
}
