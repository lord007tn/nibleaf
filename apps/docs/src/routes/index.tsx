import { createFileRoute, Link } from '@tanstack/react-router';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
        <h1 className="mb-4 text-4xl font-bold tracking-tight sm:text-5xl">Nibleaf documentation</h1>
        <p className="mb-8 max-w-2xl text-fd-muted-foreground">
          Nibleaf is the open-source, self-hostable documentation platform — an alternative to Mintlify. Write in Markdown, publish versioned docs,
          search with Orama, and host it all on your own infrastructure.
        </p>
        <Link
          to="/docs/$"
          params={{ _splat: '' }}
          className="rounded-lg bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/90"
        >
          Read the docs
        </Link>
      </main>
    </HomeLayout>
  );
}
