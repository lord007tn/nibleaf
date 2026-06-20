import type { ErrorComponentProps } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function ErrorPage({ error, reset }: ErrorComponentProps) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="font-mono text-muted-foreground text-sm">Error</span>
        <h1 className="font-semibold text-2xl tracking-tight">Something went wrong</h1>
        <p className="max-w-sm text-muted-foreground text-sm">{message}</p>
        <div className="mt-2 flex items-center gap-2">
          <Button onClick={() => reset()} variant="outline">
            Try again
          </Button>
          <Button render={<Link to="/" />}>Back home</Button>
        </div>
      </div>
    </div>
  );
}
