import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Project } from '@/hooks/api';
import { useDeleteProject } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { SectionHeader } from './shared';

export function DangerSection({ project }: { project: Project }) {
  const t = useT();
  const del = useDeleteProject();
  const navigate = useNavigate();
  const confirm = useConfirm();

  return (
    <div>
      <SectionHeader icon="⚠" title={t('settings.danger.title')} />

      <div className="mb-3.5 flex items-center gap-3.5 rounded-2xl border border-destructive/30 p-5">
        <p className="flex-1 text-[13.5px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">{t('settings.danger.transfer.title')}</strong>
          <br />
          {t('settings.danger.transfer.description')}
        </p>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button aria-disabled className="cursor-not-allowed opacity-50" variant="outline">
                  {t('settings.danger.transfer.button')}
                </Button>
              }
            />
            <TooltipContent>{t('settings.danger.comingSoon')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
            const ok = await confirm({
              title: t('settings.danger.delete.title'),
              description: t('settings.danger.delete.confirm', { name: project.name }),
              confirmLabel: t('settings.danger.delete.button'),
              destructive: true,
            });
            if (ok) {
              del.mutate(project.id, {
                onSuccess: () => {
                  toast.success(t('settings.danger.delete.toast.deleted'));
                  navigate({ to: '/app' });
                },
                onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.danger.delete.toast.error')),
              });
            }
          }}
          variant="destructive"
        >
          {t('settings.danger.delete.button')}
        </Button>
      </div>
    </div>
  );
}
