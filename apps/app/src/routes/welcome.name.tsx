import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { getSessionFn } from '@/functions/session';

const WelcomeNamePage = lazyRouteComponent(() => import('@/components/welcome-name-page'));

export const Route = createFileRoute('/welcome/name')({
  // <html lang dir> follows the interface language (lib/root-document.ts).
  staticData: { interfaceLocale: true },
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async ({ search }) => {
    const session = await getSessionFn();
    const { nameReturnPath } = await import('@/lib/name-onboarding');
    const nameDestination = nameReturnPath(search.redirect);
    if (!session) throw redirect({ to: '/sign-in', search: { next: nameDestination } });
    if (session.user.name?.trim()) throw redirect({ href: nameDestination });
    return { nameDestination };
  },
  head: () => ({ meta: [{ title: 'Welcome — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  // Method shorthand is what TanStack's code splitter moves out of the route
  // tree (a named function costs every page ~0.6 KiB). The router renders it
  // as a React component, so the hook call is valid.
  component() {
    // biome-ignore lint/correctness/useHookAtTopLevel: `component` is rendered as a React component.
    const { nameDestination } = Route.useRouteContext();
    return <WelcomeNamePage nameDestination={nameDestination} />;
  },
});
