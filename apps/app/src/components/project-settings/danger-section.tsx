import { Button } from '@midad/design-system/components/ui/button';
import { useConfirm, usePrompt } from '@midad/design-system/components/ui/confirm';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@midad/design-system/components/ui/select';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@/hooks/api';
import { useDeleteProject, useProjectMembers, useTransferProjectOwnership } from '@/hooks/api';
import { useSession } from '@/lib/auth-client';
import { useT } from '@/lib/i18n';
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
  const transferTargets = currentUserId ? (memberData?.members ?? []).filter((member) => member.user.id !== currentUserId) : [];
  const [targetMemberId, setTargetMemberId] = useState('');
  const selectedTarget = transferTargets.find((member) => member.id === targetMemberId);

  return (
    <div>
      <SectionHeader icon="⚠" title={t('settings.danger.title')} />

      <div className="mb-3.5 flex items-center gap-3.5 rounded-2xl border border-destructive/30 p-5">
        <p className="flex-1 text-[13.5px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">{t('settings.danger.transfer.title')}</strong>
          <br />
          {t('settings.danger.transfer.description')}
        </p>
        <div className="flex min-w-[250px] items-center gap-2">
          <Select
            disabled={!canTransferOwnership || transferTargets.length === 0 || transfer.isPending}
            onValueChange={(value) => setTargetMemberId(value ?? '')}
            value={targetMemberId}
          >
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue placeholder={t('settings.danger.transfer.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {transferTargets.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {member.user.name} · {member.user.email}
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

      <div className="flex items-center gap-3.5 rounded-2xl border border-destructive/30 p-5">
        <p className="flex-1 text-[13.5px] text-muted-foreground leading-relaxed">
          <strong className="text-destructive">{t('settings.danger.delete.title')}</strong>
          <br />
          {t('settings.danger.delete.description')}
        </p>
        <Button
          className="cursor-pointer"
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
