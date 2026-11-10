import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { SkeletonListRow } from '@nibleaf/design-system/components/ui/skeleton';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Laptop, Mail, Monitor, Smartphone } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { QueryErrorState } from '@/components/query-error-state';
import { PERSONAL_NOTIFICATION_KEYS, type PersonalNotificationKey, useMyPreferences, useSwitcher, useUpdatePreferences } from '@/hooks/api';
import { useAccountSessions, useDeleteAccount, useLinkedAccounts, useRevokeOtherSessions, useRevokeSession } from '@/hooks/api/account';
import { useFormatters } from '@/lib/format';
import { useSession } from '@/services/auth-client';
import { signOutDashboard } from '@/services/dashboard-session';
import { SettingsSection } from './section';

const PROVIDER_LABEL: Record<string, MessageKey> = {
  credential: 'account.signIn.email',
  'email-otp': 'account.signIn.email',
  google: 'account.signIn.google',
};

/** How you sign in: the email code always works; Google when linked. */
export function SignInMethodsSection() {
  const t = useT();
  const { data: session } = useSession();
  const accounts = useLinkedAccounts();
  const providers = new Set((accounts.data ?? []).map((account) => account.providerId));
  return (
    <SettingsSection description={t('account.signIn.description')} title={t('account.signIn.title')}>
      {accounts.isPending ? (
        <div aria-busy="true" className="mt-4">
          <SkeletonListRow />
        </div>
      ) : accounts.isError ? (
        <div className="mt-4">
          <QueryErrorState onRetry={() => void accounts.refetch()} retrying={accounts.isFetching} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border">
          <li className="flex items-center gap-3 py-2.5">
            <Mail aria-hidden className="size-4 text-muted-foreground" />
            <span className="flex-1 text-sm">
              {t('account.signIn.email')}{' '}
              <span className="text-muted-foreground">
                · <bdi dir="ltr">{session?.user?.email}</bdi>
              </span>
            </span>
            <Badge variant="secondary">{t('account.signIn.active')}</Badge>
          </li>
          {[...providers]
            .filter((provider) => provider !== 'credential' && provider !== 'email-otp')
            .map((provider) => (
              <li className="flex items-center gap-3 py-2.5" key={provider}>
                <Monitor aria-hidden className="size-4 text-muted-foreground" />
                <span className="flex-1 text-sm">{PROVIDER_LABEL[provider] ? t(PROVIDER_LABEL[provider]) : provider}</span>
                <Badge variant="secondary">{t('account.signIn.linked')}</Badge>
              </li>
            ))}
        </ul>
      )}
    </SettingsSection>
  );
}

const deviceIcon = (userAgent: string | null | undefined) => (/mobile|iphone|android/i.test(userAgent ?? '') ? Smartphone : Laptop);
const browserName = (userAgent: string | null | undefined) =>
  (userAgent ?? '').match(/(Edg|Firefox|Chrome|Safari)\/[\d.]+/)?.[1]?.replace('Edg', 'Edge') ?? null;

/** Signed-in devices, this one first; sign out any other, or all others. */
export function SessionsSection() {
  const t = useT();
  const { relativeTime } = useFormatters();
  const { data: current } = useSession();
  const sessions = useAccountSessions();
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const currentToken = (current?.session as { token?: string } | undefined)?.token;
  const list = [...(sessions.data ?? [])].sort((a, b) => Number(b.token === currentToken) - Number(a.token === currentToken));
  return (
    <SettingsSection
      action={
        list.length > 1 ? (
          <Button
            loading={revokeOthers.isPending}
            onClick={() => revokeOthers.mutate(undefined, { onError: () => toast.error(t('account.sessions.error')) })}
            size="sm"
            variant="outline"
          >
            {t('account.sessions.signOutOthers')}
          </Button>
        ) : null
      }
      description={t('account.sessions.description')}
      title={t('account.sessions.title')}
    >
      {sessions.isPending ? (
        <div aria-busy="true" className="mt-4 flex flex-col gap-1">
          <SkeletonListRow />
          <SkeletonListRow />
        </div>
      ) : sessions.isError ? (
        <div className="mt-4">
          <QueryErrorState onRetry={() => void sessions.refetch()} retrying={sessions.isFetching} />
        </div>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-border">
          {list.map((session) => {
            const Icon = deviceIcon(session.userAgent);
            const isCurrent = session.token === currentToken;
            return (
              <li className="flex min-h-12 items-center gap-3 py-2" key={session.id}>
                <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium">{browserName(session.userAgent) ?? t('account.sessions.unknownDevice')}</div>
                  <div className="truncate text-muted-foreground text-xs">
                    {session.ipAddress ? <bdi dir="ltr">{session.ipAddress}</bdi> : null}
                    {session.ipAddress ? ' · ' : null}
                    {t('account.sessions.lastActive', { when: relativeTime(String(session.updatedAt)) })}
                  </div>
                </div>
                {isCurrent ? (
                  <Badge variant="secondary">{t('account.sessions.thisDevice')}</Badge>
                ) : (
                  <Button
                    loading={revoke.isPending && revoke.variables === session.token}
                    onClick={() => revoke.mutate(session.token, { onError: () => toast.error(t('account.sessions.error')) })}
                    size="sm"
                    variant="ghost"
                  >
                    {t('account.sessions.signOut')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SettingsSection>
  );
}

const NOTIFICATION_COPY: Record<PersonalNotificationKey, { label: MessageKey; description: MessageKey }> = {
  security_login: { label: 'settings.notifications.securityLogin.label', description: 'settings.notifications.securityLogin.description' },
  project_deploy: { label: 'settings.notifications.projectDeploy.label', description: 'settings.notifications.projectDeploy.description' },
  project_deploy_failed: {
    label: 'settings.notifications.projectDeployFailed.label',
    description: 'settings.notifications.projectDeployFailed.description',
  },
  member_joined: { label: 'settings.notifications.memberJoined.label', description: 'settings.notifications.memberJoined.description' },
  project_new: { label: 'settings.notifications.projectNew.label', description: 'settings.notifications.projectNew.description' },
  workspace_weekly: { label: 'settings.notifications.workspaceWeekly.label', description: 'settings.notifications.workspaceWeekly.description' },
  workspace_plan: { label: 'settings.notifications.workspacePlan.label', description: 'settings.notifications.workspacePlan.description' },
};

/** Personal email notifications (§5.4.4): per person, default on, the same in every organization. */
export function PersonalNotificationsSection() {
  const t = useT();
  const preferences = useMyPreferences();
  const update = useUpdatePreferences();
  return (
    <SettingsSection description={t('account.notifications.description')} title={t('account.notifications.title')}>
      {preferences.isPending ? (
        <div aria-busy="true" className="mt-4 flex flex-col gap-1">
          {PERSONAL_NOTIFICATION_KEYS.map((key) => (
            <SkeletonListRow key={key} />
          ))}
        </div>
      ) : preferences.isError ? (
        <div className="mt-4">
          <QueryErrorState onRetry={() => void preferences.refetch()} retrying={preferences.isFetching} />
        </div>
      ) : (
        <div className="mt-4 flex flex-col divide-y divide-border">
          {PERSONAL_NOTIFICATION_KEYS.map((key) => (
            <NotificationToggle
              checked={preferences.data.notifications[key] ?? true}
              copy={NOTIFICATION_COPY[key]}
              key={key}
              onCheckedChange={(checked) => update.mutate({ [key]: checked }, { onError: () => toast.error(t('account.notifications.error')) })}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}

function NotificationToggle({
  copy,
  checked,
  onCheckedChange,
}: {
  copy: { label: MessageKey; description: MessageKey };
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const t = useT();
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1 leading-snug">
        <div className="font-medium text-sm" id={labelId}>
          {t(copy.label)}
        </div>
        <p className="mt-0.5 text-muted-foreground text-sm" id={descriptionId}>
          {t(copy.description)}
        </p>
      </div>
      <Switch aria-describedby={descriptionId} aria-labelledby={labelId} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/**
 * Delete account (§5.4.4): refused while you own any organization, even one
 * where you are alone. The dialog lists them with links to transfer or delete
 * first; only then can the account go.
 */
export function DeleteAccountSection() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const switcher = useSwitcher();
  const remove = useDeleteAccount();
  const [blockedOpen, setBlockedOpen] = useState(false);
  const owned = (switcher.data?.organizations ?? []).filter((org) => org.orgRole === 'owner');
  const start = async () => {
    if (owned.length > 0) {
      setBlockedOpen(true);
      return;
    }
    const ok = await confirm({
      title: t('account.delete.title'),
      description: t('account.delete.confirm'),
      confirmLabel: t('account.delete.button'),
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(undefined, {
      onSuccess: () => void signOutDashboard(queryClient, () => navigate({ to: '/sign-in', replace: true })),
      onError: () => toast.error(t('account.delete.error')),
    });
  };
  return (
    <SettingsSection className="border-destructive/30" description={t('account.delete.description')} title={t('account.delete.title')}>
      <div className="mt-4">
        <Button disabled={switcher.isPending} loading={remove.isPending} onClick={() => void start()} variant="destructive">
          {t('account.delete.button')}
        </Button>
      </div>
      <Dialog onOpenChange={setBlockedOpen} open={blockedOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('account.delete.blockedTitle')}</DialogTitle>
            <DialogDescription>{t('account.delete.blockedBody')}</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border" data-slot="owned-organizations">
            {owned.map((org) => (
              <li className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-sm" key={org.id}>
                <span className="min-w-0 flex-1 truncate font-medium">
                  <bdi>{org.name}</bdi>
                </span>
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  onClick={() => setBlockedOpen(false)}
                  params={{ orgSlug: org.slug }}
                  to="/app/o/$orgSlug/settings"
                >
                  {t('account.delete.transferOrDelete')}
                </Link>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={() => setBlockedOpen(false)} variant="outline">
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
