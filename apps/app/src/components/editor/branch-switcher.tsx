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
import { Check, GitBranch, GitMerge, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Branch } from '@/hooks/api';
import { useCreateBranch, useMergeBranch } from '@/hooks/api';
import { useT } from '@/lib/i18n';

/** Docs version switcher for the editor. Internally versions are backed by the
 *  existing Branch model, but authors see v1/v2-style docs versions. */
export function BranchSwitcher({
  projectId,
  branches,
  activeBranchId,
  onSwitch,
}: {
  projectId: string;
  branches: Branch[];
  activeBranchId: string | null;
  onSwitch: (id: string) => void;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const create = useCreateBranch(projectId);
  const merge = useMergeBranch(projectId);
  const active = branches.find((b) => b.id === activeBranchId) ?? branches.find((b) => b.isDefault) ?? branches[0];

  const mergeActive = async () => {
    if (!active || active.isDefault) {
      return;
    }
    const main = branches.find((b) => b.isDefault);
    const ok = await confirm({
      title: t('editor.branch.merge'),
      description: t('editor.branch.mergeConfirm', { name: active.name }),
      confirmLabel: t('editor.branch.merge'),
      destructive: true,
    });
    if (!ok) {
      return;
    }
    merge.mutate(active.id, {
      onSuccess: () => {
        toast.success(t('editor.branch.merged', { name: active.name }));
        if (main) {
          onSwitch(main.id);
        }
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.branch.mergeError')),
    });
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
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
        onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.branch.createError')),
      },
    );
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2.5">
              <GitBranch className="size-3.5" />
              <span className="max-w-[54px] truncate font-medium text-[12.5px] sm:max-w-[140px]">{active?.name ?? 'main'}</span>
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-56">
          {branches.map((b) => (
            <DropdownMenuItem key={b.id} onClick={() => onSwitch(b.id)}>
              <GitBranch className="size-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">{b.name}</span>
              {b.isDefault ? <span className="text-[10px] text-muted-foreground">{t('editor.branch.default')}</span> : null}
              {b.id === active?.id ? <Check className="size-3.5 text-primary" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {active && !active.isDefault ? (
            <DropdownMenuItem onClick={mergeActive}>
              <GitMerge className="size-3.5" /> {t('editor.branch.merge')}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => setCreateOpen(true)}>
            <Plus className="size-3.5" /> {t('editor.branch.new')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
            <Button type="button" onClick={submit} disabled={create.isPending}>
              {create.isPending ? t('editor.branch.creating') : t('editor.branch.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
