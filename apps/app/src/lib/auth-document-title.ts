const authTitleKey = (pathname: string) => {
  if (pathname === '/sign-in') return 'auth.signIn.submit' as const;
  if (pathname === '/sign-up') return 'auth.signUp.submit' as const;
  if (pathname === '/verify-email') return 'auth.verify.title' as const;
  if (pathname === '/forgot-password' || pathname === '/reset-password') return 'auth.passwordless.subtitle' as const;
  return null;
};

type AuthTitleKey = NonNullable<ReturnType<typeof authTitleKey>>;

export const authDocumentTitle = (pathname: string, translate: (key: AuthTitleKey) => string): string | null => {
  const key = authTitleKey(pathname);
  return key ? `${translate(key)} — Nibleaf` : null;
};
