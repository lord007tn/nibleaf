import { Button } from '@nibleaf/design-system/components/ui/button';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useLocale } from '@nibleaf/i18n/react';
import { toast } from 'sonner';
import {
  friendlyErrorMessage,
  type ReaderAccessData,
  useApproveAccessRequest,
  useDeclineAccessRequest,
  useUpdateReaderAccessRequests,
} from '@/hooks/api';
import { isolate } from '@/lib/bidi';
import { useFormatters } from '@/lib/format';

/**
 * People who asked for access from the site's sign-in screen, when the owner
 * allows it: one click to approve (which sends the usual invitation, to the
 * whole site) or to decline quietly.
 */
export function AccessRequests({ projectId, data, disabled }: { projectId: string; data: ReaderAccessData; disabled: boolean }) {
  const { t } = useLocale();
  const format = useFormatters();
  const setting = useUpdateReaderAccessRequests(projectId);
  const approve = useApproveAccessRequest(projectId);
  const decline = useDeclineAccessRequest(projectId);

  const toggle = async (enabled: boolean) => {
    try {
      await setting.mutateAsync({ enabled });
    } catch (error) {
      toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
    }
  };
  const answer = async (request: ReaderAccessData['accessRequests'][number], approved: boolean) => {
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
    <section>
      <h3 className="font-semibold text-sm">{t('settings.visibility.requests.title')}</h3>
      <p className="mt-1 text-muted-foreground text-xs">{t('settings.visibility.requests.body')}</p>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <Switch
          checked={data.readerAccessRequests}
          disabled={disabled || setting.isPending}
          id="reader-access-requests"
          onCheckedChange={(enabled) => void toggle(enabled)}
        />
        <Label htmlFor="reader-access-requests">{t('settings.visibility.requests.toggle')}</Label>
      </div>
      {data.readerAccessRequests || data.accessRequests.length > 0 ? (
        data.accessRequests.length === 0 ? (
          <p className="mt-3 text-muted-foreground text-sm">{t('settings.visibility.requests.empty')}</p>
        ) : (
          <ul className="mt-3 divide-y rounded-xl border">
            {data.accessRequests.map((request) => (
              <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between" key={request.id}>
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm" dir="auto">
                    {request.name || request.email}
                  </div>
                  {request.name ? (
                    <div className="truncate text-muted-foreground text-xs" dir="ltr">
                      {request.email}
                    </div>
                  ) : null}
                  {request.note ? (
                    <p className="mt-1 whitespace-pre-line text-sm" dir="auto">
                      {request.note}
                    </p>
                  ) : null}
                  <div className="mt-0.5 text-muted-foreground text-xs">
                    {t('settings.visibility.requests.askedOn', { date: format.date(request.createdAt) })}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    disabled={disabled}
                    loading={approve.isPending && approve.variables === request.id}
                    onClick={() => void answer(request, true)}
                    size="sm"
                    type="button"
                  >
                    {t('settings.visibility.requests.approve')}
                  </Button>
                  <Button
                    disabled={disabled}
                    loading={decline.isPending && decline.variables === request.id}
                    onClick={() => void answer(request, false)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t('settings.visibility.requests.decline')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
