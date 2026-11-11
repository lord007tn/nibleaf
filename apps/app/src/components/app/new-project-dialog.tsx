import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useLocale } from '@nibleaf/i18n/react';
import { LANGUAGE_CATALOG } from '@nibleaf/shared/languages';
import { slugify } from '@nibleaf/shared/utils';
import { type CreateProjectBody, createProjectBody, projectSlug } from '@nibleaf/validators';
import { useForm, useStore } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormField } from '@/components/ui/form-field';
import { env } from '@/env';
import { useCreateProject } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { useProjectAvailability } from '@/hooks/api/project-availability';

const languageOptions = LANGUAGE_CATALOG.map((language) => ({ value: language.code, label: language.native }));

type NewProjectDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; organizationId: string; organizationName?: string };

export function NewProjectDialog({ open, onOpenChange, organizationId, organizationName }: NewProjectDialogProps) {
  // Closing discards the draft; reopening starts with the current UI language.
  return open ? <CreateSiteDialog onOpenChange={onOpenChange} organizationId={organizationId} organizationName={organizationName} /> : null;
}

function CreateSiteDialog({ onOpenChange, organizationId, organizationName }: Omit<NewProjectDialogProps, 'open'>) {
  const { locale, t } = useLocale();
  const create = useCreateProject();
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [editingAddress, setEditingAddress] = useState(false);
  const [conflict, setConflict] = useState<{ slug: string; suggestion: string } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const form = useForm({
    defaultValues: {
      name: '',
      slug: '',
      language: (LANGUAGE_CATALOG.find((language) => language.code === (locale === 'zh-CN' ? 'zh' : locale))?.code ?? 'en') as NonNullable<
        CreateProjectBody['language']
      >,
      starter: 'product-docs' as NonNullable<CreateProjectBody['starter']>,
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const name = values.name.trim();
  const typedSlug = editingAddress ? values.slug : undefined;
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
    !pending && Boolean(name) && name.length <= 120 && validSlug && current,
  );
  const result = current ? availability.data : undefined;
  const slug = typedSlug ?? result?.slug ?? (slugify(name).slice(0, 63).replace(/-+$/g, '') || 'docs');
  const baseDomain = env.VITE_SITE_BASE_DOMAIN?.replace(/^\*\./, '').replace(/\.$/, '') || 'nibleaf.com';
  const activeConflict = conflict?.slug === slug ? conflict : null;
  const taken = Boolean(activeConflict || (result && !result.available));
  const suggestion = activeConflict?.suggestion ?? result?.suggestedSlug;
  const ready = Boolean(name && validSlug && result && !result.nameTaken && !taken && !availability.isFetching && !availability.isError);

  const createSite = async (importInstead = false) => {
    if (!ready || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setFailure(null);
    try {
      // Pin the displayed address; a concurrent claim must return a suggestion.
      const project = await create.mutateAsync(
        createProjectBody.parse({ name, slug, organizationId, language: values.language, starter: importInstead ? 'blank' : values.starter }),
      );
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
    } catch (error) {
      if (
        error instanceof ApiResponseError &&
        error.status === 409 &&
        error.reason === 'slug_taken' &&
        typeof error.details?.suggestedSlug === 'string'
      ) {
        form.setFieldValue('slug', slug);
        setEditingAddress(true);
        setConflict({ slug, suggestion: error.details.suggestedSlug });
        setStep(1);
        setFailure(null);
      } else {
        setFailure(t('newSite.error'));
      }
      return;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!pendingRef.current) onOpenChange(next);
      }}
      disablePointerDismissal={pending}
    >
      <DialogContent showCloseButton={false} aria-busy={pending || undefined} className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form
          noValidate
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready || pendingRef.current) return;
            if (step === 1) {
              setFailure(null);
              setStep(2);
            } else void createSite();
          }}
        >
          <DialogHeader>
            <DialogTitle>{step === 1 ? t('newSite.title') : t('newSite.startingPoint')}</DialogTitle>
            <DialogDescription>{organizationName ? t('newSite.descInOrganization', { org: organizationName }) : t('newSite.desc')}</DialogDescription>
          </DialogHeader>
          <fieldset className="grid min-w-0 gap-4" disabled={pending}>
            {step === 1 ? (
              <>
                <form.Field name="name">
                  {(field) => (
                    <FormField<string>
                      field={field}
                      label={t('newSite.name')}
                      layout="stacked"
                      description={
                        result?.nameTaken ? (
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
                  {editingAddress ? (
                    <form.Field name="slug">
                      {(field) => (
                        <FormField<string> field={field} label={t('newSite.address')} layout="stacked">
                          {({ controlProps, value, onValueChange }) => (
                            <Input
                              {...controlProps}
                              aria-describedby="site-address-status"
                              aria-invalid={!validSlug || taken}
                              autoCapitalize="none"
                              spellCheck={false}
                              dir="ltr"
                              maxLength={63}
                              value={value}
                              onChange={(event) => {
                                setConflict(null);
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
                              setConflict(null);
                            }
                          }}
                        >
                          {t('newSite.useSuggestion', { slug: suggestion })}
                        </Button>
                      </>
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
              </>
            ) : (
              <>
                <fieldset className="grid min-w-0 gap-3">
                  <legend className="sr-only">{t('newSite.startingPoint')}</legend>
                  {(
                    [
                      ['product-docs', 'newSite.productDocs', 'newSite.productDocsDesc'],
                      ['help-center', 'newSite.helpCenter', 'newSite.helpCenterDesc'],
                      ['blank', 'newSite.blank', 'newSite.blankDesc'],
                    ] as const
                  ).map(([value, title, description]) => (
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
                        <span className="block text-muted-foreground text-sm">{t(description)}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep(1)}>
                    {t('common.back')}
                  </Button>
                  <Button type="button" variant="link" disabled={!ready || pending} onClick={() => void createSite(true)}>
                    {t('newSite.importInstead')}
                  </Button>
                </div>
              </>
            )}
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
                if (!pendingRef.current) onOpenChange(false);
              }}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!ready || pending} loading={pending} loadingText={t('newSite.creating')} focusableWhenDisabled>
              {step === 1 ? t('newSite.continue') : t('newSite.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
