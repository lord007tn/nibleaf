import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useLocale } from '@nibleaf/i18n/react';
import { LANGUAGE_CATALOG } from '@nibleaf/shared/languages';
import { deriveSiteSlug } from '@nibleaf/shared/site-slug';
import { type CreateProjectBody, createProjectBody, projectSlug } from '@nibleaf/validators';
import { useStore } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/ui/form-field';
import { env } from '@/env';
import { useCreateProject, useOrganizationProjects } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { useProjectAvailability } from '@/hooks/api/project-availability';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';

const languageOptions = LANGUAGE_CATALOG.map((language) => ({ value: language.code, label: language.native }));

type NewProjectDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; organizationId: string; organizationName?: string };

export function NewProjectDialog({ open, onOpenChange, organizationId, organizationName }: NewProjectDialogProps) {
  const { locale, t } = useLocale();
  const create = useCreateProject();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressEdited, setAddressEdited] = useState(false);
  const [conflict, setConflict] = useState<{ slug: string; suggestion: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const completed = useRef(false);
  const destination = useRef<'editor' | 'import'>('editor');
  const projects = useOrganizationProjects(organizationId);
  const draft = useServerDraftForm({
    identity: [organizationId, generation],
    source: {
      name: '',
      slug: '',
      language: (LANGUAGE_CATALOG.find((language) => language.code === (locale === 'zh-CN' ? 'zh' : locale))?.code ?? 'en') as NonNullable<
        CreateProjectBody['language']
      >,
      starter: 'product-docs' as NonNullable<CreateProjectBody['starter']>,
    },
    onSubmit: async (submitted, save) => {
      if (!ready) return 'invalid';
      setFailure(null);
      const importInstead = destination.current === 'import';
      try {
        const project = await create.mutateAsync(
          createProjectBody.parse({
            ...submitted,
            name: submitted.name.trim(),
            slug,
            organizationId,
            starter: importInstead ? 'blank' : submitted.starter,
          }),
        );
        if (!save.isCurrent()) return 'failed';
        save.succeeded(submitted);
        toast.success(t('newSite.created'));
        if (importInstead) {
          void navigate({ to: '/app/projects/$projectId/settings', params: { projectId: project.id }, search: { section: 'contentImport' } });
        } else {
          void navigate({
            to: '/app/projects/$projectId/editor',
            params: { projectId: project.id },
            search: { page: project.firstPageId ?? undefined },
          });
        }
        return 'saved';
      } catch (error) {
        if (!save.isCurrent()) return 'failed';
        save.failed();
        if (error instanceof ApiResponseError && error.status === 409 && error.reason === 'slug_taken') {
          form.setFieldValue('slug', slug);
          setEditingAddress(true);
          setAddressEdited(true);
          setConflict({ slug, suggestion: typeof error.details?.suggestedSlug === 'string' ? error.details.suggestedSlug : '' });
          setStep(1);
        } else setFailure(t('newSite.error'));
        return 'failed';
      }
    },
  });
  const { form, isSaving: pending } = draft;
  const values = useStore(form.store, (state) => state.values);
  const name = values.name.trim();
  const derived = deriveSiteSlug(name);
  const showAddress = editingAddress || addressEdited || (Boolean(name) && derived.needsCustomAddress);
  const typedSlug = addressEdited ? values.slug : undefined;
  const validSlug = typedSlug === undefined || projectSlug.safeParse(typedSlug).success;
  const [checked, setChecked] = useState({ name, slug: typedSlug });
  useEffect(() => {
    const timer = setTimeout(() => setChecked({ name, slug: typedSlug }), 250);
    return () => clearTimeout(timer);
  }, [name, typedSlug]);
  const current = checked.name === name && checked.slug === typedSlug;
  const availability = useProjectAvailability(
    organizationId,
    checked.name,
    checked.slug,
    open && !pending && Boolean(name) && name.length <= 120 && validSlug && current,
  );
  const result = current ? availability.data : undefined;
  const slug = addressEdited ? values.slug : (result?.suggestion ?? (name ? derived.slug : 'site'));
  const baseDomain = env.VITE_SITE_BASE_DOMAIN?.replace(/^\*\./, '').replace(/\.$/, '') || 'nibleaf.com';
  const activeConflict = conflict?.slug === slug ? conflict : null;
  const taken = Boolean(activeConflict || (result && !result.available && (addressEdited || !result.suggestion)));
  const suggestion = activeConflict?.suggestion ?? result?.suggestion;
  const nameTaken =
    projects.data?.some((site) => site.name.trim().normalize('NFC').toLocaleLowerCase() === name.normalize('NFC').toLocaleLowerCase()) ?? false;
  const ready = Boolean(name && validSlug && result && !nameTaken && !taken && !availability.isFetching && !availability.isError);
  // Why Continue can't be pressed yet. An empty name is the one case with no message of its own on the form.
  const continueReason = !ready && !pending && !name ? t('newSite.reason.name') : undefined;

  const createSite = async () => {
    if ((await draft.submit()) !== 'saved') throw new Error('Site creation was not saved');
    completed.current = true;
  };
  const description = organizationName ? t('newSite.descInOrganization', { org: organizationName }) : t('newSite.desc');

  if (step === 2)
    return (
      <ActionDialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange(next);
          if (!next && completed.current) {
            completed.current = false;
            setGeneration((value) => value + 1);
            setStep(1);
            setAddressEdited(false);
            setEditingAddress(false);
            setConflict(null);
          }
        }}
        title={t('newSite.startingPoint')}
        description={description}
        confirmLabel={t('newSite.create')}
        cancelLabel={t('common.cancel')}
        pendingLabel={t('newSite.creating')}
        onConfirm={createSite}
        fallbackErrorMessage={t('newSite.error')}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <fieldset className="grid min-w-0 gap-3" disabled={pending}>
          <legend className="sr-only">{t('newSite.startingPoint')}</legend>
          {(
            [
              ['product-docs', 'newSite.productDocs', 'newSite.productDocsDesc'],
              ['help-center', 'newSite.helpCenter', 'newSite.helpCenterDesc'],
              ['blank', 'newSite.blank', 'newSite.blankDesc'],
            ] as const
          ).map(([value, title, copy]) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring"
            >
              <input
                type="radio"
                name="starter"
                value={value}
                checked={values.starter === value}
                onChange={() => form.setFieldValue('starter', value)}
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <span className="min-w-0">
                <span className="block font-medium text-sm">{t(title)}</span>
                <span className="block text-muted-foreground text-sm">{t(copy)}</span>
              </span>
            </label>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              {t('common.back')}
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={(event) => {
                destination.current = 'import';
                event.currentTarget.form?.requestSubmit();
              }}
            >
              {t('newSite.importInstead')}
            </Button>
          </div>
        </fieldset>
      </ActionDialog>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal={pending}>
      <DialogContent showCloseButton={false} aria-busy={pending || undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          noValidate
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            setFailure(null);
            destination.current = 'editor';
            setStep(2);
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('newSite.title')}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <fieldset className="grid min-w-0 gap-4" disabled={pending}>
            <form.Field name="name">
              {(field) => (
                <FormField<string>
                  field={field}
                  label={t('newSite.name')}
                  layout="stacked"
                  description={
                    nameTaken ? (
                      <span className="text-warning" role="status">
                        {t('newSite.nameTaken')}
                      </span>
                    ) : undefined
                  }
                >
                  {({ controlProps, value, onValueChange }) => (
                    <Input
                      {...controlProps}
                      autoFocus
                      dir="auto"
                      maxLength={120}
                      value={value}
                      placeholder={t('newSite.namePlaceholder')}
                      onChange={(event) => onValueChange(event.target.value)}
                    />
                  )}
                </FormField>
              )}
            </form.Field>
            <div className="grid min-w-0 gap-1.5">
              {showAddress ? (
                <form.Field name="slug">
                  {(field) => (
                    <FormField<string>
                      field={field}
                      label={t('newSite.address')}
                      layout="stacked"
                      description={derived.needsCustomAddress ? t('newSite.addressLatinHint') : undefined}
                    >
                      {({ controlProps, value, onValueChange }) => (
                        <Input
                          {...controlProps}
                          aria-describedby={[controlProps['aria-describedby'], 'site-address-status'].filter(Boolean).join(' ')}
                          aria-invalid={!validSlug || taken}
                          autoCapitalize="none"
                          spellCheck={false}
                          dir="ltr"
                          maxLength={63}
                          value={addressEdited ? value : slug}
                          onChange={(event) => {
                            setConflict(null);
                            setAddressEdited(true);
                            onValueChange(event.target.value);
                          }}
                        />
                      )}
                    </FormField>
                  )}
                </form.Field>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-x-2">
                  <span className="font-medium text-sm">{t('newSite.address')}</span>
                  <Button
                    variant="link"
                    type="button"
                    className="min-h-11"
                    onClick={() => {
                      form.setFieldValue('slug', slug);
                      setEditingAddress(true);
                    }}
                  >
                    {t('newSite.editAddress')}
                  </Button>
                </div>
              )}
              <output aria-label={t('newSite.address')} className="break-all text-muted-foreground text-sm" dir="ltr">
                {slug}.{baseDomain}
              </output>
              <div id="site-address-status" aria-live="polite" className="break-words text-sm">
                {!validSlug ? (
                  <p className="text-destructive">{t('newSite.slugInvalid')}</p>
                ) : taken && suggestion ? (
                  <>
                    <p className="text-destructive">{t('newSite.slugTaken', { slug: suggestion })}</p>
                    <Button
                      variant="link"
                      className="min-h-11 max-w-full whitespace-normal break-all"
                      type="button"
                      onClick={() => {
                        if (suggestion) {
                          form.setFieldValue('slug', suggestion);
                          setAddressEdited(true);
                          setConflict(null);
                        }
                      }}
                    >
                      {t('newSite.useSuggestion', { slug: suggestion })}
                    </Button>
                  </>
                ) : taken ? (
                  <p className="text-destructive">{t('newSite.addressUnavailable')}</p>
                ) : name && (!current || availability.isFetching) ? (
                  <p>{t('newSite.checking')}</p>
                ) : null}
              </div>
              {availability.isError ? (
                <Callout
                  tone="danger"
                  action={
                    <Button type="button" variant="outline" onClick={() => void availability.refetch()}>
                      {t('common.retry')}
                    </Button>
                  }
                >
                  {t('newSite.checkError')}
                </Callout>
              ) : null}
            </div>
            <form.Field name="language">
              {(field) => (
                <FormField<NonNullable<CreateProjectBody['language']>> field={field} label={t('newSite.language')} layout="stacked">
                  {({ controlProps, value, onValueChange }) => (
                    <Select
                      items={languageOptions}
                      value={value}
                      onValueChange={(next) => {
                        if (next) onValueChange(next);
                      }}
                    >
                      <SelectTrigger {...controlProps} className="min-h-11 w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {languageOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              )}
            </form.Field>
          </fieldset>
          {failure ? (
            <Callout tone="danger" urgent>
              {failure}
            </Callout>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              focusableWhenDisabled
              onClick={() => {
                onOpenChange(false);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!ready || pending}
              disabledReason={continueReason}
              focusableWhenDisabled
              loading={pending}
              loadingText={t('newSite.creating')}
              type="submit"
            >
              {t('newSite.continue')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
