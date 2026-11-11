import { Button } from '@nibleaf/design-system/components/ui/button';
import { usePrompt } from '@nibleaf/design-system/components/ui/confirm';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import type { Project, SwitcherOrganization } from '@/hooks/api';
import { useDeleteProject } from '@/hooks/api';
import { SectionHeader } from './shared';

/**
 * Website danger zone (§6.11): delete this website. Only the organization's
 * Owner and Admins see it; the organization and its members remain, and you
 * land back on the org's Websites. Ownership is an organization matter now
 * (org Settings → Danger zone).
 */
export function DangerSection({ project, organization }: { project: Project; organization?: SwitcherOrganization }) {
  const t = useT();
  const del = useDeleteProject();
  const navigate = useNavigate();
  const prompt = usePrompt();

  return (
    <div>
      <SectionHeader icon={<TriangleAlert className="size-4" />} title={t('settings.danger.title')} />

      <div className="flex flex-col items-stretch gap-4 rounded-2xl border border-destructive/30 p-5 sm:flex-row sm:items-center sm:gap-3.5">
        <p className="flex-1 text-[13.5px] text-muted-foreground leading-relaxed">
          <strong className="text-destructive">{t('settings.danger.delete.title')}</strong>
          <br />
          {organization ? t('settings.danger.delete.websiteDescription', { org: organization.name }) : t('settings.danger.delete.description')}
        </p>
        <Button
          className="w-full cursor-pointer sm:w-auto"
          loading={del.isPending}
          onClick={async () => {
            // Type-the-name confirmation: the website's content, analytics, search
            // and storage are erased, so require an explicit match.
            const typed = await prompt({
              title: t('settings.danger.delete.title'),
              description: t('settings.danger.delete.confirm', { name: project.name }),
              label: t('settings.danger.delete.typeToConfirm', { name: project.name }),
              placeholder: project.name,
              destructive: true,
              validate: (value) => (value === project.name ? undefined : t('settings.danger.delete.nameMismatch')),
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
                // The organization remains: back to its Websites.
                if (organization) void navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: organization.slug } });
                else void navigate({ to: '/app' });
              },
              onError: (_error) => toast.error(t('settings.danger.delete.toast.error')),
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
