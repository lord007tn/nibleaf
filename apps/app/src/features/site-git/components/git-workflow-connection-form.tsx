import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { useLocale } from '@nibleaf/i18n/react';
import { useStore } from '@tanstack/react-form';
import { Settings2 } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useMemo, useRef } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { SecretInput } from '@/components/secret-input';
import { friendlyErrorMessage } from '@/hooks/api';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { type GitWorkflowConnectionResult, useSaveGitWorkflowConnection } from '../api/git-workflow-connection';
import {
  type GitWorkflowConnectionField,
  type GitWorkflowConnectionValues,
  gitWorkflowConnectionValues,
  gitWorkflowTokenToSend,
  missingGitWorkflowConnectionFields,
  type StoredGitWorkflowConnection,
  sentGitWorkflowConnectionValues,
} from '../model/git-workflow-connection';
import { useIdentityState } from './use-identity-state';

const FIELD_IDS: Record<keyof GitWorkflowConnectionValues, string> = {
  repository: 'git2-update-repo',
  baseBranch: 'git2-update-base',
  headBranch: 'git2-update-head',
  contentPath: 'git2-update-path',
};

/**
 * Connection configuration for a connected two-way GitHub connection: the
 * repository, both branches and the content path as one explicit-save draft
 * per site and connection (operations/ui-overhaul.md §8.3), with an optional
 * new token beside it, and Save next to the `disconnect` control the host
 * owns. Enter in a field saves, as Save does, except while an IME composition
 * is open; it never reaches Sync or Update PR, which live outside this form.
 *
 * The token is the person's input only: never filled from anything stored,
 * sent only when typed (blank keeps the stored credential), and never put in
 * the draft or the mutation cache. A save that stored it clears it, unless
 * another was typed meanwhile; a failed save keeps it.
 *
 * `hidden` keeps the form mounted while another panel shows, so its edits and
 * a save in flight carry on as they did when this state lived in the host.
 */
export function GitWorkflowConnectionForm({
  projectId,
  connection,
  hidden,
  disconnect,
  onSaved,
}: {
  projectId: string;
  connection: StoredGitWorkflowConnection & { id: string };
  hidden: boolean;
  disconnect: ReactNode;
  /** After a save the form still shows succeeded, whatever is left to finish. */
  onSaved: (result: GitWorkflowConnectionResult) => void;
}) {
  const { t } = useLocale();
  const { save, pending, isPending: savePending } = useSaveGitWorkflowConnection(projectId);
  const { repository, baseBranch, headBranch, contentPath } = connection;
  // Only the edited settings: the status's operations and sync state are no edit and never reconcile the draft.
  const source = useMemo(() => ({ repository, baseBranch, headBranch, contentPath }), [repository, baseBranch, headBranch, contentPath]);
  const identity = [projectId, connection.id, 'git-workflow-connection'];
  const identityKey = JSON.stringify(identity);
  // Whether a required setting's problem shows: once a save was tried.
  const [attempted, setAttempted] = useIdentityState(identityKey, false);
  const [token, setToken] = useIdentityState(identityKey, '');
  // The token as typed now, for a save that ends after newer typing.
  const latestToken = useRef(token);
  latestToken.current = token;
  const formRef = useRef<HTMLFormElement>(null);

  const { form, ...draft } = useServerDraftForm<GitWorkflowConnectionValues>({
    identity,
    source,
    // The server trims and normalizes the settings; judge its echo by that.
    toSent: sentGitWorkflowConnectionValues,
    onSubmit: async (values, outcome) => {
      if (missingGitWorkflowConnectionFields(values).length > 0) {
        outcome.failed();
        return 'invalid';
      }
      const sentToken = gitWorkflowTokenToSend(token);
      try {
        const result = await save({ projectId, values }, sentToken);
        const clean = outcome.succeeded(gitWorkflowConnectionValues(result.connection));
        // A save for a form that is gone, or for a site or connection it has since left, says nothing here.
        if (!outcome.isCurrent()) return 'saved';
        const newerToken = gitWorkflowTokenToSend(latestToken.current) !== undefined && latestToken.current !== sentToken;
        if (sentToken) setToken((typed) => (typed === sentToken ? '' : typed));
        onSaved(result);
        // Only a form left clean says "saved": an edit, a newer token or a conflict stays on screen to finish.
        if (clean && !newerToken) {
          setAttempted(() => false);
          toast.success(t('settings.git.workflow.connected'));
        }
        return 'saved';
      } catch (error) {
        outcome.failed();
        if (outcome.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.git.workflow.connectError'));
        return 'failed';
      }
    },
  });

  // Save and Enter both come here. One save for this site at a time, whichever mount started it.
  const { submit: submitDraft, discard: discardDraft, isSaving } = draft;
  const submit = useCallback(async () => {
    if (savePending()) return;
    // A try reveals a missing setting before it takes focus.
    flushSync(() => setAttempted(() => true));
    if ((await submitDraft()) === 'invalid') formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [savePending, setAttempted, submitDraft]);
  const discard = useCallback(() => {
    if (isSaving) return;
    discardDraft();
    setToken(() => '');
    setAttempted(() => false);
  }, [discardDraft, isSaving, setAttempted, setToken]);

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
  const missing = attempted ? missingGitWorkflowConnectionFields(values) : [];
  const labels: Record<GitWorkflowConnectionField, string> = {
    repository: t('settings.git.repository.title'),
    baseBranch: t('settings.git.workflow.baseBranch'),
    headBranch: t('settings.git.workflow.headBranch'),
  };
  const tokenTyped = gitWorkflowTokenToSend(token) !== undefined;

  const text = (name: keyof GitWorkflowConnectionValues, label: string) => {
    const error = name !== 'contentPath' && missing.includes(name) ? t('validation.required', { label }) : undefined;
    const errorId = `${FIELD_IDS[name]}-error`;
    return (
      <form.Field name={name}>
        {(item) => (
          <div>
            <Label htmlFor={FIELD_IDS[name]}>{label}</Label>
            <Input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              id={FIELD_IDS[name]}
              onChange={(event) => item.handleChange(event.target.value)}
              value={item.state.value}
            />
            <FieldError errors={error ? [error] : []} id={errorId} />
          </div>
        )}
      </form.Field>
    );
  };

  return (
    <section className="rounded-xl border p-5" hidden={hidden}>
      <div className="flex items-center gap-2">
        <Settings2 className="size-5" />
        <h3 className="font-semibold">{t('settings.git.workflow.configuration')}</h3>
      </div>
      <p className="text-muted-foreground text-sm">{t('settings.git.workflow.configurationDescription')}</p>
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: it only watches the Enter its fields' keydowns bubble up, never handling or cancelling the key. */}
      <form noValidate onKeyDown={onKeyDown} onSubmit={onSubmit} ref={formRef}>
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
            className="mt-4"
            tone="warning"
          >
            {t('forms.changedElsewhere')}
          </Callout>
        ) : null}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {text('repository', labels.repository)}
          <div>
            <Label htmlFor="git2-update-token">{t('settings.git.workflow.rotateToken')}</Label>
            <SecretInput
              id="git2-update-token"
              name="github-access-token"
              onChange={(event) => {
                const typed = event.target.value;
                setToken(() => typed);
              }}
              value={token}
            />
          </div>
          {text('baseBranch', labels.baseBranch)}
          {text('headBranch', labels.headBranch)}
          {text('contentPath', t('settings.git.contentPath'))}
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          {disconnect}
          <div className="flex flex-wrap items-center gap-2">
            {(draft.isDirty || tokenTyped) && !isSaving ? (
              <Button onClick={discard} type="button" variant="ghost">
                {t('forms.discard')}
              </Button>
            ) : null}
            <Button loading={pending} loadingText={t('common.saving')} type="submit" variant="outline">
              {t('settings.git.workflow.saveConnection')}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
