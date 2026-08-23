import { Button } from '@nibleaf/design-system/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { toast } from 'sonner';
import { useCreateProject } from '@/hooks/api';
import { required } from '@/lib/form';

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateProject();
  const t = useT();
  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      await new Promise<void>((resolve) => {
        create.mutate(
          { name: value.name.trim() },
          {
            onSuccess: () => {
              toast.success(t('newSite.created'));
              form.reset();
              onOpenChange(false);
              resolve();
            },
            onError: (error) => {
              toast.error(error instanceof Error ? error.message : t('newSite.error'));
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
            <DialogDescription>{t('newSite.desc')}</DialogDescription>
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
                    placeholder="API Reference"
                    value={field.state.value}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </>
              )}
            </form.Field>
          </div>
          <DialogFooter>
            <form.Subscribe selector={(state) => [state.isSubmitting, state.values.name] as const}>
              {([isSubmitting, name]) => (
                <Button disabled={isSubmitting || !name.trim()} type="submit">
                  {isSubmitting ? t('newSite.creating') : t('newSite.create')}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
