import { Button } from '@nibleaf/design-system/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { useId } from 'react';
import { toast } from 'sonner';
import { useCreateOrganization } from '@/hooks/api';
import { required } from '@/lib/form';

/** Create an empty organization (you become its Owner), then land on its Websites empty state (§6.14). */
export function CreateOrganizationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const create = useCreateOrganization();
  const inputId = useId();
  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      try {
        const organization = await create.mutateAsync({ name: value.name.trim() });
        toast.success(t('organization.create.created', { name: organization.name }));
        form.reset();
        onOpenChange(false);
        await navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: organization.slug } });
      } catch {
        toast.error(t('organization.create.error'));
      }
    },
  });
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('organization.create.title')}</DialogTitle>
            <DialogDescription>{t('organization.create.description')}</DialogDescription>
          </DialogHeader>
          <div className="my-4 flex flex-col gap-1.5">
            <form.Field name="name" validators={{ onChange: ({ value }) => required(t('organization.create.name'), t)(value) }}>
              {(field) => (
                <>
                  <Label htmlFor={inputId}>{t('organization.create.name')}</Label>
                  <Input
                    autoFocus
                    dir="auto"
                    id={inputId}
                    maxLength={100}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={t('organization.create.namePlaceholder')}
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
                <Button disabled={!name.trim()} loading={isSubmitting} type="submit">
                  {t('organization.create.submit')}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
