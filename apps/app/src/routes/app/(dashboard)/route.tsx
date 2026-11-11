import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AccountLayout } from '@/layouts/account';

export const Route = createFileRoute('/app/(dashboard)')({
  component: AccountRoute,
});

/** Pathless layout for personal pages (Account settings): no organization chrome (§5.4.4). */
function AccountRoute() {
  return (
    <AccountLayout>
      <Outlet />
    </AccountLayout>
  );
}
