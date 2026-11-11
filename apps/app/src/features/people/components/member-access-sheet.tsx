import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';
import { TooltipButton } from '@nibleaf/design-system/components/ui/tooltip-button';
import { useT } from '@nibleaf/i18n/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { useChangeOrgRole, useReplaceMemberAccess } from '../api/mutations';
import { accessChange, type GrantSelection, type MemberRow, selectionFromGrants } from '../model/members';
import { type AssignableOrgRole, DEFAULT_INVITE_SITE_ROLE, ORG_ROLE_OPTIONS } from '../model/roles';
import { PersonCell } from './person';
import { RoleOptionList } from './role-options';
import { type ChecklistWebsite, WebsiteChecklist } from './website-checklist';

/**
 * Edit one person's access (design §6.6): their org role and, as a Member,
 * which websites they open with which role. Promoting explains what Admin
 * means; demoting starts from their dormant grants and writes exactly the
 * chosen set (none is fine). Save stays disabled with a reason until
 * something changed.
 */
export function MemberAccessSheet({
  row,
  organizationId,
  websites,
  onOpenChange,
}: {
  row: MemberRow | null;
  organizationId: string;
  websites: ChecklistWebsite[];
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={Boolean(row)}>
      <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-md">
        {row ? (
          <AccessForm key={row.member.id} onDone={() => onOpenChange(false)} organizationId={organizationId} row={row} websites={websites} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AccessForm({
  row,
  organizationId,
  websites,
  onDone,
}: {
  row: MemberRow;
  organizationId: string;
  websites: ChecklistWebsite[];
  onDone: () => void;
}) {
  const t = useT();
  const { member, person } = row;
  const before = { orgRole: member.orgRole, selection: selectionFromGrants(member.projectGrants) };
  const [orgRole, setOrgRole] = useState<AssignableOrgRole>(member.orgRole === 'admin' ? 'admin' : 'member');
  const [selection, setSelection] = useState<GrantSelection>(before.selection);
  const [failure, setFailure] = useState<string | null>(null);
  const changeRole = useChangeOrgRole(organizationId);
  const replaceAccess = useReplaceMemberAccess(organizationId);
  const change = accessChange(before, { orgRole, selection });
  const saving = changeRole.isPending || replaceAccess.isPending;

  const save = async () => {
    setFailure(null);
    try {
      if (change.kind === 'role') await changeRole.mutateAsync({ memberId: member.id, orgRole: change.orgRole, grants: change.grants });
      else if (change.kind === 'access') await replaceAccess.mutateAsync({ memberId: member.id, grants: change.grants });
      toast.success(t('people.access.saved', { name: person.primary }));
      onDone();
    } catch (error) {
      setFailure(friendlyErrorMessage(t, error, 'people.access.saveFailed'));
    }
  };

  return (
    <form
      className="flex h-full min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        if (change.kind !== 'none') void save();
      }}
    >
      <SheetHeader className="border-border border-b p-4 pe-12">
        <SheetTitle>{t('people.access.title')}</SheetTitle>
        <SheetDescription className="sr-only">{t('people.access.description', { name: person.primary })}</SheetDescription>
        <div className="pt-2">
          <PersonCell image={member.user.image} isYou={row.isYou} person={person} />
        </div>
      </SheetHeader>
      <div className="grid min-h-0 flex-1 content-start gap-5 overflow-y-auto p-4">
        <RoleOptionList disabled={saving} legend={t('people.access.orgRole')} onChange={setOrgRole} options={ORG_ROLE_OPTIONS} value={orgRole} />
        {orgRole === 'admin' ? (
          <Callout tone={member.orgRole === 'admin' ? 'neutral' : 'warning'}>{t('people.access.adminNote')}</Callout>
        ) : (
          <>
            {member.orgRole === 'admin' ? <Callout tone="info">{t('people.access.demoteNote')}</Callout> : null}
            <WebsiteChecklist
              defaultRole={DEFAULT_INVITE_SITE_ROLE}
              description={t('people.access.websitesHint')}
              disabled={saving}
              legend={t('people.access.websites')}
              onChange={setSelection}
              value={selection}
              websites={websites}
            />
          </>
        )}
        {failure ? (
          <Callout tone="danger" urgent>
            {failure}
          </Callout>
        ) : null}
      </div>
      <SheetFooter className="flex-row justify-end gap-2 border-border border-t p-4">
        <Button disabled={saving} focusableWhenDisabled onClick={onDone} type="button" variant="outline">
          {t('common.cancel')}
        </Button>
        <TooltipButton
          disabledReason={change.kind === 'none' ? t('people.access.noChanges') : undefined}
          loading={saving}
          loadingText={t('people.access.saving')}
          type="submit"
        >
          {t('people.access.save')}
        </TooltipButton>
      </SheetFooter>
    </form>
  );
}
