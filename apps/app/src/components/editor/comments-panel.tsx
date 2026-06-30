import { Check, Loader2, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@midad/design-system/components/ui/button';
import { ScrollArea } from '@midad/design-system/components/ui/scroll-area';
import { Textarea } from '@midad/design-system/components/ui/textarea';
import type { Comment } from '@/hooks/api';
import { useComments, useCreateComment, useDeleteComment, useResolveComment } from '@/hooks/api';
import { useSession } from '@/lib/auth-client';
import { useT } from '@/lib/i18n';
import { cn } from '@midad/design-system/lib/utils';

interface CommentsPanelProps {
  projectId: string;
  /** Comments are scoped to the currently-selected page. */
  pageId: string | null;
  /** A block was clicked in comment mode — compose a comment anchored to it. */
  pendingAnchor?: { quote: string; from: number; to: number } | null;
  onClearPending?: () => void;
  /** The focused comment (highlighted here + in the editor). */
  activeCommentId?: string | null;
  onSelectComment?: (id: string | null) => void;
  /** In comment mode the panel shows only threads (no page-level composer). */
  commentMode?: boolean;
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
function relativeTime(iso: string, nowLabel: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return '';
  }
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) {
    return nowLabel;
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
  'from-amber-700 to-orange-500',
  'from-stone-700 to-amber-500',
  'from-rose-500 to-orange-400',
  'from-red-700 to-amber-500',
  'from-yellow-700 to-stone-500',
  'from-orange-800 to-yellow-500',
] as const;
function gradientFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return GRADIENTS[hash % GRADIENTS.length] ?? GRADIENTS[0];
}

export function CommentsPanel({
  projectId,
  pageId,
  pendingAnchor,
  onClearPending,
  activeCommentId,
  onSelectComment,
  commentMode,
}: CommentsPanelProps) {
  const t = useT();
  const { data: session } = useSession();
  const currentUserId = session?.user?.id;
  const { data: comments, isPending } = useComments(projectId, pageId ?? undefined);
  const createComment = useCreateComment(projectId, pageId ?? undefined);
  const resolveComment = useResolveComment(projectId);
  const deleteComment = useDeleteComment(projectId);

  const [draft, setDraft] = useState('');

  const list = comments ?? [];

  const submit = (anchor?: { quote: string; from: number; to: number } | null) => {
    const body = draft.trim();
    if (!body) {
      return;
    }
    createComment.mutate(
      { body, pageId: pageId ?? null, ...(anchor ? { anchor } : {}) },
      {
        onSuccess: () => {
          setDraft('');
          if (anchor) {
            onClearPending?.();
          }
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.comments.postError')),
      },
    );
  };

  const canDelete = (comment: Comment) => Boolean(currentUserId && comment.user.id === currentUserId);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-center gap-2 px-1 pb-3">
        <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">{t('editor.comments')}</span>
        <span className="ms-auto font-mono text-muted-foreground text-xs">{list.length}</span>
      </div>

      {/* Anchored composer — appears when a block was clicked in comment mode. */}
      {pendingAnchor ? (
        <div className="mb-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
          <p className="mb-2 line-clamp-2 border-amber-400 border-s-2 ps-2 text-muted-foreground text-xs italic">“{pendingAnchor.quote}”</p>
          <Textarea
            className="min-h-[56px] resize-none text-sm"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                submit(pendingAnchor);
              }
            }}
            placeholder={t('editor.leaveComment')}
            value={draft}
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <Button
              onClick={() => {
                setDraft('');
                onClearPending?.();
              }}
              size="sm"
              variant="ghost"
            >
              {t('common.cancel')}
            </Button>
            <Button disabled={!draft.trim() || createComment.isPending} onClick={() => submit(pendingAnchor)} size="sm">
              {createComment.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('editor.comment')}
            </Button>
          </div>
        </div>
      ) : null}

      <ScrollArea className="-mx-1 min-h-0 flex-1">
        <div className="space-y-2.5 px-1">
          {isPending ? (
            <p className="px-1 text-muted-foreground text-sm">{t('common.loading')}</p>
          ) : list.length === 0 ? (
            <p className="px-1 py-6 text-center text-muted-foreground text-sm">
              {commentMode ? t('editor.comments.modeHint') : t('editor.noComments')}
            </p>
          ) : (
            list.map((comment) => (
              <div
                key={comment.id}
                className={cn(
                  'rounded-xl border p-3 transition-colors',
                  comment.id === activeCommentId ? 'border-primary/50 bg-primary/5' : 'border-border bg-card',
                  comment.resolved && 'opacity-60',
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelectComment?.(comment.id === activeCommentId ? null : comment.id)}
                  className="block w-full text-start"
                >
                  {comment.anchor?.quote ? (
                    <p className="mb-2 line-clamp-1 border-amber-400/70 border-s-2 ps-2 text-[11.5px] text-muted-foreground italic">
                      “{comment.anchor.quote}”
                    </p>
                  ) : null}
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
                    <span className="ms-auto text-muted-foreground text-xs">{relativeTime(comment.createdAt, t('editor.comments.now'))}</span>
                  </div>
                  <p className={cn('mt-2 whitespace-pre-wrap text-foreground/90 text-sm leading-relaxed', comment.resolved && 'line-through')}>
                    {comment.body}
                  </p>
                </button>
                <div className="mt-2 flex items-center gap-1">
                  <Button
                    className={cn('h-6 gap-1 px-1.5 text-xs', comment.resolved ? 'text-primary' : 'text-muted-foreground')}
                    disabled={resolveComment.isPending}
                    onClick={() => resolveComment.mutate({ id: comment.id, resolved: !comment.resolved })}
                    size="sm"
                    variant="ghost"
                  >
                    <Check className="size-3" />
                    {comment.resolved ? t('editor.comments.resolved') : t('editor.comments.resolve')}
                  </Button>
                  {canDelete(comment) ? (
                    <Button
                      aria-label={t('editor.comments.deleteAria')}
                      className="ms-auto size-6 text-muted-foreground hover:text-destructive"
                      disabled={deleteComment.isPending}
                      onClick={() =>
                        deleteComment.mutate(comment.id, {
                          onError: (err) => toast.error(err instanceof Error ? err.message : t('editor.comments.deleteError')),
                        })
                      }
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

      {/* Page-level composer — only outside comment mode (in comment mode you click a block). */}
      {!commentMode && !pendingAnchor ? (
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
            placeholder={t('editor.leaveComment')}
            value={draft}
          />
          <Button className="w-full" disabled={!draft.trim() || createComment.isPending} onClick={() => submit()} size="sm">
            {createComment.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {t('editor.comment')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

