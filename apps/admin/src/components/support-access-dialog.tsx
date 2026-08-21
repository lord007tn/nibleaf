import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Eye, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStartSupportAccess } from '@/hooks/api/mutations';

export type SupportAccessTarget = {
  userId: string;
  label: string;
  detail: string;
  organizationId: string;
};

export function SupportAccessDialog({ targets, subject }: { targets: SupportAccessTarget[]; subject: string }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(targets[0]?.organizationId ? `${targets[0].userId}:${targets[0].organizationId}` : '');
  const start = useStartSupportAccess();

  useEffect(() => {
    if (!targets.some((target) => `${target.userId}:${target.organizationId}` === selected)) {
      setSelected(targets[0] ? `${targets[0].userId}:${targets[0].organizationId}` : '');
    }
  }, [selected, targets]);

  const target = targets.find((item) => `${item.userId}:${item.organizationId}` === selected);

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button disabled={targets.length === 0} onClick={() => setOpen(true)} title={targets.length ? undefined : 'No eligible customer has access'}>
        <Eye className="size-4" /> Support access
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open {subject} as a customer?</DialogTitle>
          <DialogDescription>
            This creates a one-hour support session in the customer app. Your admin session remains separate and every start and stop is recorded.
          </DialogDescription>
        </DialogHeader>

        {targets.length > 1 ? (
          <label className="grid gap-2 text-sm" htmlFor="support-access-target">
            <span className="font-medium">Customer and workspace</span>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              id="support-access-target"
              onChange={(event) => setSelected(event.target.value)}
              value={selected}
            >
              {targets.map((item) => (
                <option key={`${item.userId}:${item.organizationId}`} value={`${item.userId}:${item.organizationId}`}>
                  {item.label} — {item.detail}
                </option>
              ))}
            </select>
          </label>
        ) : target ? (
          <div className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{target.label}</p>
            <p className="text-muted-foreground text-xs">{target.detail}</p>
          </div>
        ) : null}

        <Alert>
          <ShieldAlert />
          <AlertTitle>Use only for an active support need</AlertTitle>
          <AlertDescription>
            You will have the customer’s workspace permissions. Avoid private content unless it is necessary to resolve the reported issue, and stop
            access when finished.
          </AlertDescription>
        </Alert>

        <DialogFooter>
          <Button disabled={start.isPending} onClick={() => setOpen(false)} variant="outline">
            Cancel
          </Button>
          <Button
            disabled={!target || start.isPending}
            onClick={() => target && start.mutate({ userId: target.userId, organizationId: target.organizationId })}
          >
            {start.isPending ? 'Starting…' : 'Start support access'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
