import { Check, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useComments, useCreateComment, useDeleteComment, useResolveComment } from '@/hooks/api';
import type { Comment } from '@/hooks/api';
import { useSession } from '@/lib/auth-client';
import { cn } from '@/lib/utils';

interface CommentsPanelProps {
  projectId: string;
  /** Comments are scoped to the currently-selected page. */
  pageId: string | null;
}

/** Initials from a display name, e.g. "Mei Kawano" → "MK". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) {
    return '?';
  }
  if (parts.length === 1) {
    return first.slice(0, 2).toUpperCase();
  }
  const last = parts[parts.length - 1] ?? first;
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

/** Compact relative time, e.g. "now", "5m", "3h", "2d". */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) {
    return 'now';
  }
  const mins = Math.round(secs / 60);
  if (mins < 60) {
    return `${mins}m`;
  }
  const hrs = Math.round(mins / 60);
  if (hrs < 24) {
    return `${hrs}h`;
  }
  const days = Math.round(hrs / 24);
  if (days < 7) {
    return `${days}d`;
  }
  return `${Math.round(days / 7)}w`;
}

/** Stable gradient per user id so avatars stay visually distinct. */
const GRADIENTS = [
  'from-emerald-500 to-teal-400',
  'from-violet-500 to-indigo-400',
  'from-rose-500 to-orange-400',
  'from-sky-500 to-cyan-400',
  'from-amber-500 to-yellow-400',
  'from-fuchsia-500 to-pink-400',
] as const;
function gradientFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[hash % GRADIENTS.length] ?? GRADIENTS[0];
}

export function CommentsPanel({ projectId, pageId }: CommentsPanelProps) {
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: comments, isPending } = useComments(projectId, pageId ?? undefined);
  const createComment = useCreateComment(projectId, pageId ?? undefined);
  const resolveComment = useResolveComment(projectId);
  const deleteComment = useDeleteComment(projectId);

  const [draft, setDraft] = useState('');

  const list = comments ?? [];

  const submit = () => {
    const body = draft.trim();
    if (!body) {
      return;
    }
    createComment.mutate(
      { body, pageId: pageId ?? null },
      {
        onSuccess: () => setDraft(''),
        onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not post the comment.'),
      },
    );
  };

  const canDelete = (comment: Comment) => Boolean(currentUserId && comment.user.id === currentUserId);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-1 pb-3">
        <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">Comments</span>
        <span className="ms-auto font-mono text-muted-foreground text-xs">{list.length}</span>
      </div>

      <ScrollArea className="-mx-1 min-h-0 flex-1">
        <div className="space-y-2.5 px-1">
          {isPending ? (
            <p className="px-1 text-muted-foreground text-sm">Loading…</p>
          ) : list.length === 0 ? (
            <p className="px-1 py-6 text-center text-muted-foreground text-sm">No comments yet.</p>
          ) : (
            list.map((comment) => (
              <div
                className={cn(
                  'rounded-xl border border-border bg-card p-3',
                  comment.resolved && 'opacity-60',
                )}
                key={comment.id}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-[10px] text-white',
                      gradientFor(comment.user.id),
                    )}
                  >
                    {initials(comment.user.name)}
                  </span>
                  <span className="font-semibold text-sm">{comment.user.name}</span>
                  <span className="ms-auto text-muted-foreground text-xs">{relativeTime(comment.createdAt)}</span>
                </div>
                <p className={cn('mt-2 whitespace-pre-wrap text-foreground/90 text-sm leading-relaxed', comment.resolved && 'line-through')}>
                  {comment.body}
                </p>
                <div className="mt-2 flex items-center gap-1">
                  <Button
                    className={cn('h-6 gap-1 px-1.5 text-xs', comment.resolved ? 'text-primary' : 'text-muted-foreground')}
                    disabled={resolveComment.isPending}
                    onClick={() => resolveComment.mutate({ id: comment.id, resolved: !comment.resolved })}
                    size="sm"
                    variant="ghost"
                  >
                    <Check className="size-3" />
                    {comment.resolved ? 'Resolved' : 'Resolve'}
                  </Button>
                  {canDelete(comment) ? (
                    <Button
                      className="ms-auto size-6 text-muted-foreground hover:text-destructive"
                      disabled={deleteComment.isPending}
                      onClick={() => deleteComment.mutate(comment.id, { onError: (e) => toast.error(e instanceof Error ? e.message : 'Could not delete.') })}
                      size="icon-xs"
                      variant="ghost"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <div className="mt-3 space-y-2 border-border border-t pt-3">
        <Textarea
          className="min-h-[60px] resize-none text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Leave a comment…"
          value={draft}
        />
        <Button className="w-full" disabled={!draft.trim() || createComment.isPending} onClick={submit} size="sm">
          {createComment.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Comment
        </Button>
      </div>
    </div>
  );
}
