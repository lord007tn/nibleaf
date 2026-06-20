import { Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
        <h1 className="mb-2 text-6xl font-bold tracking-tight">404</h1>
        <p className="mb-8 text-fd-muted-foreground">
          We couldn&apos;t find the page you were looking for.
        </p>
        <Link
          to="/docs/$"
          params={{ _splat: '' }}
          className="rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
        >
          Back to the docs
        </Link>
      </main>
    </HomeLayout>
  );
}
