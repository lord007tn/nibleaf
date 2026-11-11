import { createFileRoute, lazyRouteComponent, redirect } from '@tanstack/react-router';
import { getSessionFn } from '@/functions/session';

const WelcomeNamePage = lazyRouteComponent(() => import('@/components/welcome-name-page'));

export const Route = createFileRoute('/welcome/name')({
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
  component() {
    const { nameDestination } = Route.useRouteContext();
    return <WelcomeNamePage nameDestination={nameDestination} />;
  },
});
