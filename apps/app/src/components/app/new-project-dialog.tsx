import { Button } from '@nibleaf/design-system/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useCreateProject } from '@/hooks/api';
import { required } from '@/lib/form';

/** New website, created inside `organizationId` (§6.10): no new organization, you land in its editor. */
export function NewProjectDialog({
  open,
  onOpenChange,
  organizationId,
  organizationName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationName?: string;
}) {
  const create = useCreateProject();
  const t = useT();
  const navigate = useNavigate();
  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      await new Promise<void>((resolve) => {
        create.mutate(
          { name: value.name.trim(), organizationId },
          {
            onSuccess: (project) => {
              toast.success(t('newSite.created'));
              form.reset();
              onOpenChange(false);
              resolve();
              // A new site's next step is its first article, so open the editor.
              void navigate({ to: '/app/projects/$projectId/editor', params: { projectId: project.id } });
            },
            onError: () => {
              // The server's message is English and technical; show the localized one.
              toast.error(t('newSite.error'));
              resolve();
            },
          },
        );
      });
    },
  });
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('newSite.title')}</DialogTitle>
            <DialogDescription>{organizationName ? t('newSite.descInOrganization', { org: organizationName }) : t('newSite.desc')}</DialogDescription>
          </DialogHeader>
          <div className="my-4 flex flex-col gap-1.5">
            <form.Field name="name" validators={{ onChange: ({ value }) => required(t('newSite.name'), t)(value) }}>
              {(field) => (
                <>
                  <Label htmlFor="new-project-name">{t('newSite.name')}</Label>
                  <Input
                    autoFocus
                    id="new-project-name"
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={t('newSite.namePlaceholder')}
                    value={field.state.value}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </>
              )}
            </form.Field>
          </div>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              {t('common.cancel')}
            </Button>
            <form.Subscribe selector={(state) => [state.isSubmitting, state.values.name] as const}>
              {([isSubmitting, name]) => (
                <Button disabled={!name.trim()} loading={isSubmitting} loadingText={t('newSite.creating')} type="submit">
                  {t('newSite.create')}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
