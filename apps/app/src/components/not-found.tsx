import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';

export function NotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-background px-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="font-mono text-muted-foreground text-sm">404</span>
        <h1 className="font-semibold text-2xl tracking-tight">Page not found</h1>
        <p className="max-w-sm text-muted-foreground text-sm">The page you are looking for doesn't exist or has moved.</p>
        <Button className="mt-2" render={<Link to="/" />}>
          Back home
        </Button>
      </div>
    </div>
  );
}
