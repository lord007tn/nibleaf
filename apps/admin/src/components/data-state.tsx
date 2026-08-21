import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { AlertCircle, Inbox } from 'lucide-react';

export function DataError({ message = 'This operational data could not be loaded.', retry }: { message?: string; retry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertTitle>Unable to load data</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>{message}</span>
        <Button onClick={retry} size="sm" variant="outline">
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  );
}

export function DataEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-40 place-items-center px-4 py-8 text-center">
      <div className="flex max-w-sm flex-col items-center gap-2">
        <span className="grid size-9 place-items-center rounded-full bg-muted">
          <Inbox className="size-4 text-muted-foreground" />
        </span>
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{description}</p>
      </div>
    </div>
  );
}
