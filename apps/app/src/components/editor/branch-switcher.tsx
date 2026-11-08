import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nibleaf/design-system/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, GitMerge, Layers, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Branch, BranchMergePreview } from '@/hooks/api';
import { branchMergePreviewQueryOptions, friendlyErrorMessage, useCreateBranch, useMergeBranch } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { asPromotePreview, promoteNeedsReview } from './promote-review';
import { PromoteReviewDialog } from './promote-review-dialog';

/** Promote refusals the writer resolves from main: the toast keeps the server's
 *  explanation and offers the one step it starts with. */
const RESOLVED_FROM_MAIN = new Set(['branch:main_changed', 'branch:baseline_missing']);

/** Docs version switcher for the editor. Internally versions are backed by the
 *  existing Branch model, but authors see v1/v2-style docs versions. */
export function BranchSwitcher({
  projectId,
  branches,
  activeBranchId,
  onSwitch,
  beforeChange,
  hideTrigger = false,
  createOpen: controlledCreateOpen,
  onCreateOpenChange,
  readOnly = false,
}: {
  projectId: string;
  branches: Branch[];
  activeBranchId: string | null;
  onSwitch: (id: string) => void;
  beforeChange?: () => Promise<void>;
  /** Render only the "New version" dialog (e.g. while the site has a single version). */
  hideTrigger?: boolean;
  /** Control the "New version" dialog from outside (e.g. an overflow menu item). */
  createOpen?: boolean;
  onCreateOpenChange?: (open: boolean) => void;
  /** Viewers switch between versions to read them; they cannot create or promote one. */
  readOnly?: boolean;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [uncontrolledCreateOpen, setUncontrolledCreateOpen] = useState(false);
  const createOpen = controlledCreateOpen ?? uncontrolledCreateOpen;
  const setCreateOpen = (open: boolean) => {
    setUncontrolledCreateOpen(open);
    onCreateOpenChange?.(open);
  };
  const [name, setName] = useState('');
  const create = useCreateBranch(projectId);
  const merge = useMergeBranch(projectId);
  const active = branches.find((b) => b.id === activeBranchId) ?? branches.find((b) => b.isDefault) ?? branches[0];

  const queryClient = useQueryClient();
  const main = branches.find((b) => b.isDefault);
  /** The pages main changed since the version was copied, while the writer reviews them. */
  const [review, setReview] = useState<{ version: Branch; preview: BranchMergePreview } | null>(null);

  /** A refusal the writer resolves from main: the server's explanation, plus the one
   *  step it starts with. Long enough to read; the action only switches versions. */
  const refuseFromMain = (message: string) => {
    if (!main) {
      toast.error(message);
      return;
    }
    toast.error(message, { duration: 20_000, action: { label: t('editor.branch.switchToMain'), onClick: () => onSwitch(main.id) } });
  };

  const promote = (version: Branch, confirmPreview?: string) => {
    merge.mutate(confirmPreview ? { id: version.id, confirmPreview } : version.id, {
      onSuccess: () => {
        setReview(null);
        toast.success(t('editor.branch.merged', { name: version.name }));
        if (main) {
          onSwitch(main.id);
        }
      },
      onError: (e) => {
        const message = friendlyErrorMessage(t, e, 'editor.branch.mergeError');
        if (e instanceof ApiResponseError) {
          // Main changed again, or the moves clash: review the fresh list.
          const fresh = e.code === 'branch:main_changed' || e.code === 'branch:promote_blocked' ? asPromotePreview(e.details) : null;
          if (fresh) {
            setReview({ version, preview: fresh });
            return;
          }
          // A save raced the promote and nothing changed: say so, then look again.
          if (e.reason === 'promote_raced') {
            setReview(null);
            toast.error(message);
            void reviewAndPromote(version);
            return;
          }
          if (RESOLVED_FROM_MAIN.has(e.code ?? '')) {
            setReview(null);
            refuseFromMain(message);
            return;
          }
        }
        toast.error(message);
      },
    });
  };

  /** Load what main changed since the version was copied, then confirm the promote:
   *  a plain confirm when promoting keeps every page main changed (or there are
   *  none), the review dialog otherwise. */
  const reviewAndPromote = async (version: Branch) => {
    let preview: BranchMergePreview;
    try {
      preview = await queryClient.fetchQuery({ ...branchMergePreviewQueryOptions(projectId, version.id), staleTime: 0 });
    } catch (e) {
      toast.error(friendlyErrorMessage(t, e, 'editor.branch.mergeError'));
      return;
    }
    if (!preview.baselineComplete) {
      refuseFromMain(t('error.branchBaselineMissing'));
      return;
    }
    if (promoteNeedsReview(preview)) {
      setReview({ version, preview });
      return;
    }
    const ok = await confirm({
      title: t('editor.branch.merge'),
      description: t('editor.branch.mergeConfirm', { name: version.name }),
      confirmLabel: t('editor.branch.merge'),
      destructive: true,
    });
    if (ok) {
      // Every page main changed stays as it is, so this list needs no review.
      promote(version, preview.changedOnMainSinceFork.length > 0 ? preview.fingerprint : undefined);
    }
  };

  const mergeActive = async () => {
    if (!active || active.isDefault) {
      return;
    }
    try {
      await beforeChange?.();
    } catch {
      toast.error(t('editor.saveError'));
      return;
    }
    await reviewAndPromote(active);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      return;
    }
    try {
      await beforeChange?.();
    } catch {
      toast.error(t('editor.saveError'));
      return;
    }
    create.mutate(
      { name: trimmed, fromBranchId: active?.id },
      {
        onSuccess: (branch) => {
          toast.success(t('editor.branch.created', { name: branch.name }));
          setCreateOpen(false);
          setName('');
          onSwitch(branch.id);
        },
        onError: (e) => toast.error(friendlyErrorMessage(t, e, 'editor.branch.createError')),
      },
    );
  };

  const triggerLabel = t('editor.branch.trigger', { name: active?.name ?? 'main' });
  return (
    <>
      {hideTrigger ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2.5"
                aria-label={triggerLabel}
                loading={merge.isPending}
                title={triggerLabel}
              >
                <Layers className="size-3.5" />
                <span className="max-w-[54px] truncate font-medium text-[12.5px] sm:max-w-[140px]" dir="ltr">
                  {active?.name ?? 'main'}
                </span>
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            {branches.map((b) => (
              <DropdownMenuItem key={b.id} onClick={() => onSwitch(b.id)}>
                <Layers className="size-3.5 text-muted-foreground" />
                <span className="flex-1 truncate" dir="ltr">
                  {b.name}
                </span>
                {b.isDefault ? <span className="text-[10px] text-muted-foreground">{t('editor.branch.default')}</span> : null}
                {b.id === active?.id ? <Check className="size-3.5 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            {readOnly ? null : (
              <>
                <DropdownMenuSeparator />
                {active && !active.isDefault ? (
                  <DropdownMenuItem disabled={merge.isPending} onClick={mergeActive}>
                    <GitMerge className="size-3.5" /> {t('editor.branch.merge')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={() => setCreateOpen(true)}>
                  <Plus className="size-3.5" /> {t('editor.branch.new')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <PromoteReviewDialog
        preview={review?.preview ?? null}
        versionName={review?.version.name ?? ''}
        pending={merge.isPending}
        onConfirm={(fingerprint) => {
          if (review) promote(review.version, fingerprint);
        }}
        onClose={() => setReview(null)}
      />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editor.branch.new')}</DialogTitle>
            <DialogDescription>{t('editor.branch.dialogDesc', { name: active?.name ?? 'main' })}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="branch-name">{t('editor.branch.nameLabel')}</Label>
            <Input
              id="branch-name"
              autoFocus
              dir="ltr"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="v2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  submit();
                }
              }}
            />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
            <Button type="button" onClick={submit} loading={create.isPending} loadingText={t('editor.branch.creating')}>
              {t('editor.branch.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
