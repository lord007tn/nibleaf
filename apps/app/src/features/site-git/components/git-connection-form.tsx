import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useT } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { GitBranch } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { GithubIcon } from '@/components/icons/brand';
import { DirtyStateReporter } from '@/components/project-settings/shared';
import { useBranches, useLanguages } from '@/hooks/api';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveGitConnection } from '../api/git-connection';
import {
  type GitConnectionField,
  type GitConnectionValues,
  type GitProvider,
  gitConnectionValues,
  missingGitConnectionField,
  type StoredGit,
  sentGitConnectionValues,
} from '../model/git-connection';
import { useIdentityState } from './use-identity-state';

const FIELD_IDS: Record<GitConnectionField, string> = { repo: 'git-repo', cloneUrl: 'git-clone-url' };

/**
 * The legacy import's Repository settings: the provider and its fields as one
 * explicit-save draft per site (operations/ui-overhaul.md §8.3), with its own
 * Connect/Save button rather than a save bar, beside the `disconnect` control
 * the tab owns. Enter in a field saves, as the button does, except while an
 * IME composition is open.
 *
 * The PATCH replaces `git` whole, so a save waits out any other write to this
 * site's `git` still in flight (auto publish, disconnect, or a save from an
 * earlier mount), and shows it as busy.
 */
export function GitConnectionForm({
  projectId,
  git,
  connected,
  disconnect,
}: {
  projectId: string;
  git: StoredGit | null | undefined;
  connected: boolean;
  disconnect?: ReactNode;
}) {
  const t = useT();
  const { save, pending, isPending: savePending } = useSaveGitConnection(projectId);
  const { data: branches } = useBranches(projectId);
  const { data: languages } = useLanguages(projectId);
  const source = useMemo(() => gitConnectionValues(git), [git]);
  const identity = JSON.stringify([projectId, 'git-connection']);
  // Whether the required field's problem shows: once a save was tried. Not on leaving the field, which
  // would move the buttons under a pointer already pressing Save.
  const [attempted, setAttempted] = useIdentityState(identity, false);
  const formRef = useRef<HTMLFormElement>(null);

  const { form, ...draft } = useServerDraftForm<GitConnectionValues>({
    identity: [projectId, 'git-connection'],
    source,
    // The save trims, clears the other providers' fields and fills defaults; judge its echo by that.
    toSent: sentGitConnectionValues,
    onSubmit: async (values, outcome) => {
      if (missingGitConnectionField(values)) {
        outcome.failed();
        return 'invalid';
      }
      try {
        const saved = await save({ projectId, values });
        // Only a draft left clean says "saved": an edit made meanwhile, or a conflict, stays on screen to finish.
        if (outcome.succeeded(gitConnectionValues(saved.git))) {
          setAttempted(() => false);
          toast.success(t('settings.git.repoSaved'));
        }
        return 'saved';
      } catch {
        outcome.failed();
        // A save for a site this form has since left says nothing here.
        if (outcome.isCurrent()) toast.error(t('settings.git.saveError'));
        return 'failed';
      }
    },
  });

  // The button and Enter both come here. One write to this site's `git` at a
  // time, whichever control or mount started it.
  const { submit: submitDraft, discard: discardDraft, isSaving } = draft;
  const submit = useCallback(async () => {
    if (savePending()) return;
    // A try reveals the missing field before it takes focus.
    flushSync(() => setAttempted(() => true));
    if ((await submitDraft()) === 'invalid') formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [savePending, setAttempted, submitDraft]);
  const discard = useCallback(() => {
    if (isSaving) return;
    discardDraft();
    setAttempted(() => false);
  }, [discardDraft, isSaving, setAttempted]);

  // An Enter that confirms an IME composition must not save; the key itself still reaches the IME.
  // Implicit submission happens in the same task as its keydown, so it is remembered until the task ends.
  const composing = useRef(false);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLFormElement>) => {
    if (!event.nativeEvent.isComposing && event.keyCode !== 229) return;
    composing.current = true;
    setTimeout(() => {
      composing.current = false;
    });
  }, []);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (composing.current) return;
    void submit();
  };

  const values = useStore(form.store, (state) => state.values);
  const { provider } = values;
  const missing = missingGitConnectionField(values);
  const problem = (field: GitConnectionField) =>
    missing === field && attempted
      ? t('validation.required', { label: t(field === 'repo' ? 'settings.git.repoUrl' : 'settings.git.cloneUrl') })
      : undefined;

  const branchOptions: Array<{ value: string | null; label: string }> = [
    { value: null, label: t('settings.git.defaultBranch') },
    ...(branches ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
  ];
  const languageOptions: Array<{ value: string | null; label: string }> = [
    { value: null, label: t('settings.git.defaultLanguage') },
    ...(languages ?? []).map((language) => ({ value: language.id, label: `${language.label} (${language.code})` })),
  ];
  const providers: Array<{ value: GitProvider; label: string; icon: ReactNode }> = [
    { value: 'github', label: 'GitHub', icon: <GithubIcon className="size-4" /> },
    { value: 'gitlab', label: 'GitLab', icon: <GitBranch className="size-4" /> },
    { value: 'git', label: t('settings.git.provider.git.name'), icon: <GitBranch className="size-4" /> },
  ];

  const address = (field: GitConnectionField, label: string, placeholder: string) => {
    const error = problem(field);
    const errorId = `${FIELD_IDS[field]}-error`;
    return (
      <form.Field name={field}>
        {(item) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={FIELD_IDS[field]}>{label}</Label>
            <Input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              className="font-mono"
              dir="ltr"
              id={FIELD_IDS[field]}
              onChange={(event) => item.handleChange(event.target.value)}
              placeholder={placeholder}
              value={item.state.value}
            />
            <FieldError errors={error ? [error] : []} id={errorId} />
          </div>
        )}
      </form.Field>
    );
  };

  const text = (name: 'instanceUrl' | 'branch' | 'path', id: string, label: string, placeholder: string) => (
    <form.Field name={name}>
      {(item) => (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={id}>{label}</Label>
          <Input
            className="font-mono"
            dir="ltr"
            id={id}
            onChange={(event) => item.handleChange(event.target.value)}
            placeholder={placeholder}
            value={item.state.value}
          />
        </div>
      )}
    </form.Field>
  );

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: it only watches the Enter its fields' keydowns bubble up, never handling or cancelling the key.
    <form noValidate onKeyDown={onKeyDown} onSubmit={onSubmit} ref={formRef}>
      <DirtyStateReporter dirty={draft.isDirty || isSaving} />
      {draft.conflicts.length > 0 ? (
        <Callout
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  for (const key of draft.conflicts) draft.resolveConflict(key, 'theirs');
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t('forms.useTheirs')}
              </Button>
              <Button
                onClick={() => {
                  for (const key of draft.conflicts) draft.resolveConflict(key, 'mine');
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('forms.keepMine')}
              </Button>
            </div>
          }
          className="mb-4"
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}
      <div className="mb-4 grid grid-cols-3 gap-2">
        {providers.map((item) => (
          <Button
            aria-pressed={provider === item.value}
            className="justify-start"
            key={item.value}
            onClick={() => form.setFieldValue('provider', item.value)}
            type="button"
            variant={provider === item.value ? 'secondary' : 'outline'}
          >
            {item.icon}
            {item.label}
          </Button>
        ))}
      </div>

      {provider === 'gitlab' ? (
        <div className="mb-4">{text('instanceUrl', 'git-instance-url', t('settings.git.instanceUrl'), 'https://gitlab.com')}</div>
      ) : null}
      {provider === 'git'
        ? address('cloneUrl', t('settings.git.cloneUrl'), 'https://git.example.com/acme/docs.git')
        : address('repo', t('settings.git.repoUrl'), provider === 'gitlab' ? 'group/project' : 'acme-inc/docs')}
      <div className="mt-4 grid grid-cols-2 gap-4">
        {text('branch', 'git-branch', t('settings.git.productionBranch'), 'main')}
        {text('path', 'git-path', t('settings.git.contentPath'), 'docs')}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <form.Field name="importBranchId">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="git-import-branch">{t('settings.git.importBranch')}</Label>
              <Select items={branchOptions} onValueChange={(next) => field.handleChange(next ?? '')} value={field.state.value || null}>
                <SelectTrigger className="w-full font-mono" dir="ltr" id="git-import-branch">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent dir="ltr">
                  {branchOptions.map((option) => (
                    <SelectItem key={option.value ?? ''} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
        <form.Field name="importLanguageId">
          {(field) => (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="git-import-language">{t('settings.git.importLanguage')}</Label>
              <Select items={languageOptions} onValueChange={(next) => field.handleChange(next ?? '')} value={field.state.value || null}>
                <SelectTrigger className="w-full" id="git-import-language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value ?? ''} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {disconnect ?? <span />}
        <div className="flex flex-wrap items-center gap-2">
          {draft.isDirty && !isSaving ? (
            <Button onClick={discard} type="button" variant="ghost">
              {t('forms.discard')}
            </Button>
          ) : null}
          <Button loading={pending} loadingText={t('common.saving')} type="submit" variant={connected ? 'outline' : 'default'}>
            {connected ? t('settings.git.save') : t('settings.git.connect')}
          </Button>
        </div>
      </div>
    </form>
  );
}
