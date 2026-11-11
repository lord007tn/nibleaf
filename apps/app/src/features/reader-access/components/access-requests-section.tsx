import { Button } from '@nibleaf/design-system/components/ui/button';
import { DataList, DataListEmpty, DataListItem } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { SettingsRow } from '@nibleaf/design-system/components/ui/settings-row';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useT } from '@nibleaf/i18n/react';
import { Inbox } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { ReaderAccessData } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { isolate } from '@/lib/bidi';
import { useFormatters } from '@/lib/format';
import type { SiteAdminState } from '@/lib/project-settings-access';
import { useApproveRequest, useDeclineRequest, useSetAccessRequests } from '../api/hooks';
import { decisionProps, manageDecision, showsRequestList } from '../model/access';

/** How long the "Saved" hint stays next to the switch after it applied. */
const SAVED_HINT_MS = 3000;

type AccessRequest = ReaderAccessData['accessRequests'][number];

/**
 * People who asked for access from the site's sign-in page, when the owner
 * allows it. The switch applies on change and waits for the server; each
 * request is approved (which sends the usual invitation, to the whole site)
 * or declined quietly in one click.
 */
export function AccessRequestsSection({ projectId, data, status }: { projectId: string; data: ReaderAccessData; status: SiteAdminState }) {
  const t = useT();
  const setting = useSetAccessRequests(projectId);
  const approve = useApproveRequest(projectId);
  const decline = useDeclineRequest(projectId);
  const [saved, setSaved] = useState(false);
  const toggle = decisionProps(manageDecision(status, setting.isPending));
  const answer = decisionProps(manageDecision(status));

  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), SAVED_HINT_MS);
    return () => clearTimeout(timer);
  }, [saved]);

  const setEnabled = (enabled: boolean) => {
    setSaved(false);
    setting.mutateAsync({ enabled }).then(
      () => setSaved(true),
      (error: unknown) => toast.error(friendlyErrorMessage(t, error, 'settings.saveError')),
    );
  };
  const respond = async (request: AccessRequest, approved: boolean) => {
    try {
      if (approved) {
        await approve.mutateAsync(request.id);
        toast.success(t('settings.visibility.requests.approved', { email: isolate(request.email) }));
      } else {
        await decline.mutateAsync(request.id);
        toast.success(t('settings.visibility.requests.declined'));
      }
    } catch (error) {
      toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
    }
  };

  return (
    <SettingsSection description={t('settings.visibility.requests.body')} title={t('settings.visibility.requests.title')}>
      <SettingsRow control="switch" disabledReason={toggle.reason ? t(toggle.reason) : undefined} label={t('settings.visibility.requests.toggle')}>
        {(ids) => (
          <span className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs" role="status">
              {saved ? t('common.saved') : ''}
            </span>
            <Switch
              {...ids.controlProps}
              aria-labelledby={ids.labelId}
              checked={data.readerAccessRequests}
              disabled={toggle.disabled}
              onCheckedChange={setEnabled}
            />
          </span>
        )}
      </SettingsRow>
      {showsRequestList(data) ? (
        data.accessRequests.length === 0 ? (
          <DataListEmpty>
            <EmptyState headingLevel={3} icon={<Inbox />} title={t('settings.visibility.requests.empty')} />
          </DataListEmpty>
        ) : (
          <DataList aria-label={t('settings.visibility.requests.title')}>
            {data.accessRequests.map((request) => (
              <RequestRow
                approving={approve.isPending && approve.variables === request.id}
                declining={decline.isPending && decline.variables === request.id}
                disabled={answer.disabled}
                key={request.id}
                onAnswer={(approved) => void respond(request, approved)}
                request={request}
              />
            ))}
          </DataList>
        )
      ) : null}
    </SettingsSection>
  );
}

function RequestRow({
  request,
  approving,
  declining,
  disabled,
  onAnswer,
}: {
  request: AccessRequest;
  approving: boolean;
  declining: boolean;
  disabled: boolean;
  onAnswer: (approved: boolean) => void;
}) {
  const t = useT();
  const format = useFormatters();
  const who = request.name || request.email;
  return (
    <DataListItem
      description={
        request.note ? (
          <span className="whitespace-pre-line text-foreground" dir="auto">
            {request.note}
          </span>
        ) : undefined
      }
      meta={
        <>
          {request.name ? <span dir="ltr">{request.email}</span> : null}
          <span>{t('settings.visibility.requests.askedOn', { date: format.date(request.createdAt) })}</span>
        </>
      }
      title={<span dir="auto">{who}</span>}
      trailing={
        <>
          <Button disabled={disabled} loading={approving} onClick={() => onAnswer(true)} size="sm" type="button">
            {t('settings.visibility.requests.approve')}
            <span className="sr-only"> {who}</span>
          </Button>
          <Button disabled={disabled} loading={declining} onClick={() => onAnswer(false)} size="sm" type="button" variant="outline">
            {t('settings.visibility.requests.decline')}
            <span className="sr-only"> {who}</span>
          </Button>
        </>
      }
      trailingLayout="stack"
    />
  );
}
