import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm, usePrompt } from '@nibleaf/design-system/components/ui/confirm';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@/hooks/api';
import { useDeleteProject, useProjectMembers, useTransferProjectOwnership } from '@/hooks/api';
import { useSession } from '@/services/auth-client';
import { SectionHeader } from './shared';

export function DangerSection({ project }: { project: Project }) {
  const t = useT();
  const del = useDeleteProject();
  const transfer = useTransferProjectOwnership(project.id);
  const { data: memberData } = useProjectMembers(project.id);
  const { data: session } = useSession();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const currentUserId = session?.user?.id;
  const currentMember = (memberData?.members ?? []).find((member) => member.user.id === currentUserId);
  const canTransferOwnership = currentMember?.role === 'owner';
  // Ownership can only move to an ADMIN (server enforces this with a 409) —
  // offer only valid targets so the picker can't dead-end.
  const transferTargets = currentUserId
    ? (memberData?.members ?? []).filter((member) => member.user.id !== currentUserId && member.role === 'admin')
    : [];
  const [targetMemberId, setTargetMemberId] = useState('');
  const selectedTarget = transferTargets.find((member) => member.id === targetMemberId);
  // One array feeds both the trigger label (`items`) and the rendered options so they can't drift.
  const transferOptions = transferTargets.map((member) => ({
    value: member.id,
    label: (
      <span dir="auto">
        {member.user.name} · {member.user.email}
      </span>
    ),
  }));

  return (
    <div>
      <SectionHeader icon={<TriangleAlert className="size-4" />} title={t('settings.danger.title')} />

      <div className="mb-3.5 flex flex-col items-stretch gap-4 rounded-2xl border border-destructive/30 p-5 sm:flex-row sm:items-center sm:gap-3.5">
        <p className="flex-1 text-[13.5px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">{t('settings.danger.transfer.title')}</strong>
          <br />
          {t('settings.danger.transfer.description')}
        </p>
        <div className="flex w-full items-center gap-2 sm:min-w-[250px] sm:w-auto">
          <Select
            disabled={!canTransferOwnership || transferTargets.length === 0 || transfer.isPending}
            items={transferOptions}
            onValueChange={(value) => setTargetMemberId(value ?? '')}
            value={targetMemberId}
          >
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue placeholder={t('settings.danger.transfer.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {transferOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!canTransferOwnership || !targetMemberId || transfer.isPending}
            onClick={async () => {
              if (!selectedTarget) {
                return;
              }
              const ok = await confirm({
                title: t('settings.danger.transfer.title'),
                description: t('settings.danger.transfer.confirm', { name: selectedTarget.user.name }),
                confirmLabel: t('settings.danger.transfer.button'),
                destructive: true,
              });
              if (!ok) {
                return;
              }
              transfer.mutate(
                { memberId: selectedTarget.id },
                {
                  onSuccess: () => {
                    toast.success(t('settings.danger.transfer.toast.transferred'));
                    setTargetMemberId('');
                  },
                  onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.danger.transfer.toast.error')),
                },
              );
            }}
            variant="outline"
          >
            {t('settings.danger.transfer.button')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col items-stretch gap-4 rounded-2xl border border-destructive/30 p-5 sm:flex-row sm:items-center sm:gap-3.5">
        <p className="flex-1 text-[13.5px] text-muted-foreground leading-relaxed">
          <strong className="text-destructive">{t('settings.danger.delete.title')}</strong>
          <br />
          {t('settings.danger.delete.description')}
        </p>
        <Button
          className="w-full cursor-pointer sm:w-auto"
          onClick={async () => {
            // Type-the-name confirmation: deleting a project cascades its whole
            // org (members, pages, deployments, domains), so require an explicit
            // match — not a single click.
            const typed = await prompt({
              title: t('settings.danger.delete.title'),
              description: t('settings.danger.delete.confirm', { name: project.name }),
              label: t('settings.danger.delete.typeToConfirm', { name: project.name }),
              placeholder: project.name,
              confirmLabel: t('settings.danger.delete.button'),
            });
            if (typed === null) {
              return;
            }
            if (typed !== project.name) {
              toast.error(t('settings.danger.delete.nameMismatch'));
              return;
            }
            del.mutate(project.id, {
              onSuccess: () => {
                toast.success(t('settings.danger.delete.toast.deleted'));
                navigate({ to: '/app' });
              },
              onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.danger.delete.toast.error')),
            });
          }}
          variant="destructive"
        >
          {t('settings.danger.delete.button')}
        </Button>
      </div>
    </div>
  );
}
