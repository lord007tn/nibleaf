import { Loader2, Rocket } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { usePublish } from '@/hooks/api';
import type { Project } from '@/hooks/api/types';
import { siteHref } from '@/lib/links';

interface PublishModalProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the publish mutation is fired, to hand off to the deploy pipeline. */
  onPublished: () => void;
}

/** Confirmation dialog before publishing to production. Faithful to design lines 959-993. */
export function PublishModal({ project, open, onOpenChange, onPublished }: PublishModalProps) {
  const publish = usePublish(project.id);
  const [message, setMessage] = useState('');

  const doPublish = () => {
    const trimmed = message.trim();
    publish.mutate(trimmed || undefined, {
      onError: (error) => toast.error(error instanceof Error ? error.message : 'Publish failed'),
    });
    setMessage('');
    onOpenChange(false);
    onPublished();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[460px]" showCloseButton={false}>
        <DialogHeader className="gap-1 border-border border-b px-6 pt-5 pb-4">
          <DialogTitle className="font-semibold text-[17px] tracking-tight">Publish to production</DialogTitle>
          <DialogDescription className="text-[13.5px]">Your changes go live instantly on your domain.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg text-base"
              style={{ backgroundColor: `${project.color}1a`, color: project.color }}
            >
              ✎
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate font-semibold text-[13.5px]">{project.name}</div>
              <div className="truncate font-mono text-[12.5px] text-muted-foreground">{siteHref(project.id)}</div>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide" htmlFor="publish-message">
              What changed?
            </label>
            <Input
              id="publish-message"
              placeholder="Describe this release (optional)"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !publish.isPending) doPublish();
              }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2.5 px-6 pt-0 pb-5 sm:justify-stretch">
          <DialogClose render={<Button variant="outline" className="h-[42px] flex-none px-4" />}>Cancel</DialogClose>
          <Button className="h-[42px] flex-1" disabled={publish.isPending} onClick={doPublish}>
            {publish.isPending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            Publish now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
