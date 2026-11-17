import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { IntegrationProviderId } from '@nibleaf/shared/integrations';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { integrationErrorMessage } from '@/hooks/api/integrations';
import { useWebhookIntegrationSave, type WebhookIntegrationSave } from '../api/webhook-integration-save';

/**
 * Connect / Save of one webhook panel (Slack, Discord, Zapier). A press is
 * accepted only while no send for this site and provider is in flight, from
 * this panel or another one, and this panel holds no current press, so presses
 * in the same tick send one request.
 *
 * The panel that pressed owns the answer while the press is current: it says
 * "connected" or "saved" and clears the URL field, or shows one error. Editing
 * the URL (`retire`, even back to the same value), another provider, another
 * site, another query client, or the panel unmounting retires the press: its
 * answer then says nothing and leaves the fields as they are. The send itself
 * still refreshes the site it was for (`useWebhookIntegrationSave`). Label
 * edits keep the press. Nothing here holds the URL; it goes straight to the
 * send.
 *
 * `save` and `retire` belong to the committed panel they were rendered for,
 * and `save` sends only that panel's site and provider. Kept past an unmount,
 * a change of site, provider or query client (with or without a remount), or
 * taken from a render React never committed, `save` sends nothing and returns
 * false, and `retire` does nothing.
 */
export function useWebhookIntegrationSaveCommand({
  projectId,
  providerId,
  providerName,
}: {
  projectId: string;
  providerId: IntegrationProviderId;
  providerName: MessageKey;
}) {
  const t = useT();
  const { send, pending, isPending } = useWebhookIntegrationSave(projectId, providerId);
  const cache = useQueryClient();
  // The panel this render is for: another site, provider or query client is another panel, even without a remount.
  const panel = useMemo(() => ({ projectId, providerId, cache }), [projectId, providerId, cache]);
  // The panel React committed, null once unmounted.
  const committed = useRef<object | null>(null);
  const current = useRef<object | null>(null);
  // An answer is worded in the language shown when it arrives.
  const translate = useRef(t);
  useLayoutEffect(() => {
    translate.current = t;
  }, [t]);
  useLayoutEffect(() => {
    committed.current = panel;
    return () => {
      // Leaving this panel retires its press.
      committed.current = null;
      current.current = null;
    };
  }, [panel]);

  // A kept `retire` of another panel leaves this panel's press alone.
  const retire = useCallback(() => {
    if (committed.current === panel) current.current = null;
  }, [panel]);

  /** Sends `save` with `webhookUrl`; `saved` runs once the panel still owns a success. False when the press is refused. */
  const save = (request: WebhookIntegrationSave, webhookUrl: string, saved: () => void) => {
    if (committed.current !== panel || request.projectId !== projectId || request.providerId !== providerId) return false;
    if (current.current || isPending()) return false;
    const press = {};
    current.current = press;
    const owned = () => {
      if (current.current !== press) return false;
      current.current = null;
      return true;
    };
    send(request, webhookUrl).then(
      (result) => {
        // Null: the session ended, and nothing is said for it.
        if (!(owned() && result)) return;
        const words = translate.current;
        toast.success(
          request.revision === null
            ? words('settings.integrations.connectedToast', { name: words(providerName) })
            : words('settings.integrations.updatedToast'),
        );
        saved();
      },
      (error: unknown) => {
        if (owned()) toast.error(integrationErrorMessage(translate.current, error));
      },
    );
    return true;
  };

  return { save, retire, pending };
}
