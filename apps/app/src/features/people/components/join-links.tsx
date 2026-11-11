import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { CopyButton } from '@nibleaf/design-system/components/ui/copy-button';
import { DataList, DataListEmpty, DataListItem, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { useT } from '@nibleaf/i18n/react';
import { Ban, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { useFormatters } from '@/lib/format';
import { type LinkScope, useCreateJoinLink, useDeleteJoinLink, useDisableJoinLink, useRegenerateJoinLink } from '../api/mutations';
import type { JoinLinkRecord } from '../api/query-options';
import {
  DEFAULT_JOIN_DRAFT,
  draftNeedsWarning,
  EXPIRY_LABEL,
  EXPIRY_OPTIONS,
  JOIN_LINK_STATUS,
  type JoinLinkDraft,
  type JoinLinkStatus,
  joinLinkBody,
  joinLinkErrors,
  linkActions,
} from '../model/join-links';
import { DEFAULT_JOIN_LINK_SITE_ROLE, SITE_ROLE_OPTIONS, type SiteRole, siteRoleLabel } from '../model/roles';
import { RoleOptionList } from './role-options';
import { type ChecklistWebsite, WebsiteChecklist } from './website-checklist';

/**
 * Join links of an organization or of one website (design §6.2): their state,
 * what they grant, who made them and how many joined. Active links can be
 * regenerated or disabled; dead ones deleted (WORKSPACE-12). A link's URL is
 * shown once, right after it is made.
 */
export function JoinLinksList({ scope, links, onCreate }: { scope: LinkScope; links: JoinLinkRecord[]; onCreate: () => void }) {
  const t = useT();
  const { date } = useFormatters();
  const regenerate = useRegenerateJoinLink(scope);
  const disable = useDisableJoinLink(scope);
  const remove = useDeleteJoinLink(scope);
  const [shown, setShown] = useState<{ url: string; regenerated: boolean } | null>(null);
  const [disabling, setDisabling] = useState<JoinLinkRecord | null>(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const name = (link: JoinLinkRecord) => link.label || t('people.links.untitled');

  if (!links.length)
    return (
      <DataListEmpty>
        <EmptyState
          action={
            <Button onClick={onCreate} size="sm" variant="outline">
              <Link2 aria-hidden className="size-4" /> {t('people.links.create')}
            </Button>
          }
          description={t('people.links.emptyHint')}
          icon={<Link2 />}
          title={t('people.links.empty')}
        />
      </DataListEmpty>
    );

  return (
    <>
      <DataList aria-label={t('people.links.title')}>
        {links.map((link) => {
          const status = link.status as JoinLinkStatus;
          const actions = linkActions(status);
          const view = JOIN_LINK_STATUS[status] ?? JOIN_LINK_STATUS.revoked;
          return (
            <DataListItem
              badges={
                <StatusBadge size="sm" tone={view.tone}>
                  {t(view.label)}
                </StatusBadge>
              }
              description={link.grants.map((grant) => `${grant.project.name} (${t(siteRoleLabel(grant.role))})`).join(' · ')}
              key={link.id}
              leading={
                <span aria-hidden className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Link2 className="size-4" />
                </span>
              }
              meta={
                <>
                  {link.createdBy ? <span>{t('people.links.createdBy', { name: link.createdBy.name || link.createdBy.email })}</span> : null}
                  <span>
                    {link.maxUses
                      ? t('people.links.usesOf', { count: link.useCount, max: link.maxUses })
                      : t('people.links.uses', { count: link.useCount })}
                  </span>
                  <span>{link.expiresAt ? t('people.links.expires', { date: date(link.expiresAt) }) : t('people.links.noExpiry')}</span>
                  {link.allowedDomain ? <span dir="ltr">{t('people.links.domainOnly', { domain: link.allowedDomain })}</span> : null}
                </>
              }
              title={<bdi>{name(link)}</bdi>}
              trailing={
                <RowActions label={t('people.links.actionsFor', { name: name(link) })}>
                  {actions.regenerate ? (
                    <RowActionsItem
                      icon={<RefreshCw aria-hidden />}
                      onSelect={() =>
                        regenerate.mutate(link.id, {
                          onSuccess: (created) => setShown({ url: created.url, regenerated: true }),
                          onError: (error) => toast.error(friendlyErrorMessage(t, error, 'people.links.regenerateFailed')),
                        })
                      }
                    >
                      {t('people.links.regenerate')}
                    </RowActionsItem>
                  ) : null}
                  {actions.disable ? (
                    <RowActionsItem
                      destructive
                      icon={<Ban aria-hidden />}
                      onSelect={() => {
                        setDisabling(link);
                        setDisableOpen(true);
                      }}
                    >
                      {t('people.links.disable')}
                    </RowActionsItem>
                  ) : null}
                  {actions.delete ? (
                    <RowActionsItem
                      destructive
                      icon={<Trash2 aria-hidden />}
                      onSelect={() =>
                        remove.mutate(link.id, {
                          onSuccess: () => toast.success(t('people.links.deleted', { name: name(link) })),
                          onError: (error) => toast.error(friendlyErrorMessage(t, error, 'people.links.deleteFailed')),
                        })
                      }
                    >
                      {t('people.links.delete')}
                    </RowActionsItem>
                  ) : null}
                </RowActions>
              }
            />
          );
        })}
      </DataList>
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={t('people.links.disable')}
        description={t('people.links.disableConfirm')}
        destructive
        errorMessage={(error) => friendlyErrorMessage(t, error, 'people.links.disableFailed')}
        fallbackErrorMessage={t('people.links.disableFailed')}
        onConfirm={async () => {
          if (!disabling) return;
          await disable.mutateAsync(disabling.id);
          toast.success(t('people.links.disabled', { name: name(disabling) }));
        }}
        onOpenChange={setDisableOpen}
        open={disableOpen}
        pendingLabel={t('people.links.disabling')}
        title={t('people.links.disableTitle', { name: disabling ? name(disabling) : '' })}
      />
      <LinkUrlDialog onOpenChange={(open) => !open && setShown(null)} shown={shown} />
    </>
  );
}

/** The URL of a link that was just made or regenerated: shown once, with Copy. */
function LinkUrlDialog({ shown, onOpenChange }: { shown: { url: string; regenerated: boolean } | null; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const id = useId();
  // Keep the last URL while the dialog fades out.
  const [last, setLast] = useState(shown);
  if (shown && shown !== last) setLast(shown);
  return (
    <Dialog onOpenChange={onOpenChange} open={Boolean(shown)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{last?.regenerated ? t('people.links.regeneratedTitle') : t('people.links.createdTitle')}</DialogTitle>
          <DialogDescription>{t('people.links.onceHint')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 items-center gap-2">
          <Label className="sr-only" htmlFor={id}>
            {t('people.links.url')}
          </Label>
          <Input className="font-mono text-sm" dir="ltr" id={id} onFocus={(event) => event.currentTarget.select()} readOnly value={last?.url ?? ''} />
          <CopyButton
            copiedLabel={t('people.links.copied')}
            failedLabel={t('people.invitations.copyFailed')}
            label={t('people.links.copy')}
            size="default"
            value={last?.url ?? ''}
            variant="default"
          >
            {t('people.links.copy')}
          </CopyButton>
        </div>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
            {t('people.invite.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Make a join link. At org level it can grant several websites (a checklist);
 * on a website it grants that website. Viewer by default; Editor or Admin gets
 * a warning, because anyone holding the link gets it.
 */
export function CreateJoinLinkDialog({
  open,
  onOpenChange,
  scope,
  websites,
  allowedRoles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: LinkScope;
  /** Org scope: the websites to choose from. Site scope: the one website. */
  websites: ChecklistWebsite[];
  allowedRoles?: SiteRole[];
}) {
  const t = useT();
  const id = useId();
  const create = useCreateJoinLink(scope);
  const site = scope.kind === 'site' ? scope.projectId : null;
  const initial = (): JoinLinkDraft => ({ ...DEFAULT_JOIN_DRAFT, grants: site ? { [site]: DEFAULT_JOIN_LINK_SITE_ROLE } : {} });
  const [draft, setDraft] = useState<JoinLinkDraft>(initial);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const errors = joinLinkErrors(draft);
  const show = (key: keyof typeof errors) => (attempted && errors[key] ? t(errors[key]) : null);
  const update = (patch: Partial<JoinLinkDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = async () => {
    setAttempted(true);
    setFailure(null);
    if (Object.keys(errors).length) return;
    try {
      const result = await create.mutateAsync(joinLinkBody(draft));
      setCreated(result.url);
    } catch (error) {
      setFailure(friendlyErrorMessage(t, error, 'people.links.createFailed'));
    }
  };

  return (
    <>
      <Dialog
        onOpenChange={(next) => !create.isPending && onOpenChange(next)}
        onOpenChangeComplete={(next) => {
          if (next) return;
          setDraft(initial());
          setAttempted(false);
          setFailure(null);
        }}
        open={open && !created}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
          <form
            className="grid min-w-0 gap-5"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <DialogHeader>
              <DialogTitle>{t('people.links.createTitle')}</DialogTitle>
              <DialogDescription>{t('people.links.createDescription')}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-label`}>{t('people.links.label')}</Label>
              <Input
                aria-describedby={show('label') ? `${id}-label-error` : undefined}
                aria-invalid={Boolean(show('label')) || undefined}
                id={`${id}-label`}
                maxLength={60}
                onChange={(event) => update({ label: event.target.value })}
                placeholder={t('people.links.labelPlaceholder')}
                value={draft.label}
              />
              {show('label') ? (
                <p className="text-destructive text-xs" id={`${id}-label-error`}>
                  {show('label')}
                </p>
              ) : null}
            </div>
            {site ? (
              <RoleOptionList
                legend={t('people.links.role')}
                onChange={(role) => update({ grants: { [site]: role } })}
                options={SITE_ROLE_OPTIONS.filter((option) => !allowedRoles || allowedRoles.includes(option.role))}
                value={draft.grants[site] ?? DEFAULT_JOIN_LINK_SITE_ROLE}
              />
            ) : (
              <WebsiteChecklist
                defaultRole={DEFAULT_JOIN_LINK_SITE_ROLE}
                description={t('people.links.websitesHint')}
                error={show('grants')}
                legend={t('people.links.websites')}
                onChange={(grants) => update({ grants })}
                value={draft.grants}
                websites={websites}
              />
            )}
            {draftNeedsWarning(draft) ? <Callout tone="warning">{t('people.links.elevatedWarning')}</Callout> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`${id}-expiry`}>{t('people.links.expiry')}</Label>
                <Select
                  items={EXPIRY_OPTIONS.map((value) => ({ value, label: t(EXPIRY_LABEL[value]) }))}
                  onValueChange={(value) => value && update({ expiry: value as JoinLinkDraft['expiry'] })}
                  value={draft.expiry}
                >
                  <SelectTrigger className="w-full" id={`${id}-expiry`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPIRY_OPTIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(EXPIRY_LABEL[value])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid content-start gap-1.5">
                <Label htmlFor={`${id}-uses`}>{t('people.links.maxUses')}</Label>
                <Input
                  aria-describedby={show('maxUses') ? `${id}-uses-error` : `${id}-uses-hint`}
                  aria-invalid={Boolean(show('maxUses')) || undefined}
                  id={`${id}-uses`}
                  inputMode="numeric"
                  onChange={(event) => update({ maxUses: event.target.value })}
                  placeholder={t('people.links.unlimited')}
                  value={draft.maxUses}
                />
                {show('maxUses') ? (
                  <p className="text-destructive text-xs" id={`${id}-uses-error`}>
                    {show('maxUses')}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs" id={`${id}-uses-hint`}>
                    {t('people.links.maxUsesHint')}
                  </p>
                )}
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${id}-domain`}>{t('people.links.domain')}</Label>
              <Input
                aria-describedby={show('allowedDomain') ? `${id}-domain-error` : `${id}-domain-hint`}
                aria-invalid={Boolean(show('allowedDomain')) || undefined}
                autoCapitalize="off"
                dir="ltr"
                id={`${id}-domain`}
                onChange={(event) => update({ allowedDomain: event.target.value })}
                placeholder="example.com"
                value={draft.allowedDomain}
              />
              {show('allowedDomain') ? (
                <p className="text-destructive text-xs" id={`${id}-domain-error`}>
                  {show('allowedDomain')}
                </p>
              ) : (
                <p className="text-muted-foreground text-xs" id={`${id}-domain-hint`}>
                  {t('people.links.domainHint')}
                </p>
              )}
            </div>
            {failure ? (
              <Callout tone="danger" urgent>
                {failure}
              </Callout>
            ) : null}
            <DialogFooter>
              <Button disabled={create.isPending} focusableWhenDisabled onClick={() => onOpenChange(false)} type="button" variant="outline">
                {t('common.cancel')}
              </Button>
              <Button loading={create.isPending} loadingText={t('people.links.creating')} type="submit">
                {t('people.links.create')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <LinkUrlDialog
        onOpenChange={(next) => {
          if (next) return;
          setCreated(null);
          onOpenChange(false);
        }}
        shown={created ? { url: created, regenerated: false } : null}
      />
    </>
  );
}
