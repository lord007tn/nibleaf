import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { DataList, DataListItem, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { useT } from '@nibleaf/i18n/react';
import { Link2, Mail, RefreshCw, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { useFormatters } from '@/lib/format';
import { copyToClipboard, inviteAcceptUrl } from '@/lib/invitations';
import { isAlreadyAccepted } from '../api/mutations';
import { invitationTiming } from '../model/invitations';

export interface InvitationRowModel {
  id: string;
  email: string;
  inviterName: string | null;
  createdAt?: string;
  expiresAt: string;
  /** What it grants, already in words (e.g. "Member · Docs (Editor), API (Viewer)"). */
  scope: ReactNode;
}

/**
 * Pending invitations as rows: who, what they'll get, who invited them, when
 * it was sent and when it expires (WORKSPACE-11). Each row's labelled ⋯ menu
 * offers Copy invite link, Resend and Revoke; revoking asks first.
 */
export function InvitationsList({
  rows,
  canManage,
  onResend,
  onRevoke,
  revokeLabel,
  revokeDescription,
}: {
  rows: InvitationRowModel[];
  canManage: boolean;
  onResend: (id: string) => Promise<{ emailed: boolean }>;
  onRevoke: (id: string) => Promise<unknown>;
  /** "Revoke invitation" (org) or "Remove from this invitation" (a website's part of it). */
  revokeLabel: string;
  revokeDescription: (email: string) => string;
}) {
  const t = useT();
  const { relativeTime, date } = useFormatters();
  const [revoking, setRevoking] = useState<InvitationRowModel | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [resending, setResending] = useState<string | null>(null);

  const copy = async (row: InvitationRowModel) => {
    const ok = await copyToClipboard(inviteAcceptUrl(row.id));
    if (ok) toast.success(t('people.invitations.copiedFor', { email: row.email }));
    else toast.error(t('people.invitations.copyFailed'));
  };
  const resend = async (row: InvitationRowModel) => {
    setResending(row.id);
    try {
      const { emailed } = await onResend(row.id);
      toast.success(emailed ? t('people.invitations.resent', { email: row.email }) : t('people.invitations.renewed', { email: row.email }));
    } catch (error) {
      toast.error(t('people.invitations.resendFailed', { email: row.email }), {
        description: friendlyErrorMessage(t, error, 'people.invitations.resendFailedDetail'),
      });
    } finally {
      setResending(null);
    }
  };

  return (
    <>
      <DataList aria-label={t('people.invitations.title')}>
        {rows.map((row) => {
          const timing = invitationTiming(row.expiresAt);
          return (
            <DataListItem
              badges={
                timing.expired ? (
                  <StatusBadge size="sm" tone="warning">
                    {t('people.invitations.expired')}
                  </StatusBadge>
                ) : null
              }
              description={row.scope}
              key={row.id}
              leading={
                <span aria-hidden className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Mail className="size-4" />
                </span>
              }
              meta={
                <>
                  <span>
                    {row.inviterName
                      ? t('people.invitations.invitedBy', { name: row.inviterName, when: row.createdAt ? relativeTime(row.createdAt) : '' })
                      : row.createdAt
                        ? t('people.invitations.sent', { when: relativeTime(row.createdAt) })
                        : null}
                  </span>
                  <span>
                    {timing.expired
                      ? t('people.invitations.expiredOn', { date: date(row.expiresAt) })
                      : t('people.invitations.expiresOn', { date: date(row.expiresAt) })}
                  </span>
                </>
              }
              title={<bdi dir="ltr">{row.email}</bdi>}
              trailing={
                canManage ? (
                  <RowActions label={t('people.invitations.actionsFor', { email: row.email })}>
                    <RowActionsItem icon={<Link2 aria-hidden />} onSelect={() => void copy(row)}>
                      {t('people.invitations.copyLink')}
                    </RowActionsItem>
                    <RowActionsItem
                      disabledReason={resending === row.id ? t('people.invitations.resending') : undefined}
                      icon={<RefreshCw aria-hidden />}
                      onSelect={() => void resend(row)}
                    >
                      {t('people.invitations.resend')}
                    </RowActionsItem>
                    <RowActionsItem
                      destructive
                      icon={<Trash2 aria-hidden />}
                      onSelect={() => {
                        setRevoking(row);
                        setRevokeOpen(true);
                      }}
                    >
                      {revokeLabel}
                    </RowActionsItem>
                  </RowActions>
                ) : null
              }
            />
          );
        })}
      </DataList>
      {/* Its own dialog with its own target, kept while it closes: the title never flips mid-animation (defect c). */}
      <ActionDialog
        cancelLabel={t('common.cancel')}
        confirmLabel={revokeLabel}
        description={revoking ? revokeDescription(revoking.email) : undefined}
        destructive
        errorMessage={(error) =>
          isAlreadyAccepted(error) ? t('people.invitations.alreadyAccepted') : friendlyErrorMessage(t, error, 'people.invitations.revokeFailed')
        }
        fallbackErrorMessage={t('people.invitations.revokeFailed')}
        onConfirm={async () => {
          if (!revoking) return;
          await onRevoke(revoking.id);
          toast.success(t('people.invitations.revoked', { email: revoking.email }));
        }}
        onOpenChange={setRevokeOpen}
        open={revokeOpen}
        pendingLabel={t('people.invitations.revoking')}
        title={revokeLabel}
      />
    </>
  );
}
