import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { copyToClipboard } from '@/lib/invitations';
import { SettingsSection } from './section';

export function ApiKeysTab({ projectId }: { projectId: string }) {
  const t = useT();
  const { data: keys } = useApiKeys(projectId);
  const createKey = useCreateApiKey(projectId);
  const revokeKey = useRevokeApiKey(projectId);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {secret ? (
        <SettingsSection title={t('settings.apiKeys.created.title')} description={t('settings.apiKeys.created.description')}>
          <div className="flex gap-2">
            <Input className="font-mono" readOnly value={secret} />
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (await copyToClipboard(secret)) {
                  toast.success(t('settings.apiKeys.copied'));
                }
              }}
            >
              {t('settings.apiKeys.copy')}
            </Button>
          </div>
        </SettingsSection>
      ) : null}

      <SettingsSection title={t('settings.apiKeys.title')} description={t('settings.apiKeys.description')}>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (!trimmed) {
              return;
            }
            createKey.mutate(
              { name: trimmed, scopes: ['*'] },
              {
                onSuccess: (key) => {
                  setSecret(key.secret ?? null);
                  setName('');
                  toast.success(t('settings.apiKeys.created.toast'));
                },
                onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.apiKeys.createError')),
              },
            );
          }}
        >
          <Input onChange={(event) => setName(event.target.value)} placeholder={t('settings.apiKeys.namePlaceholder')} value={name} />
          <Button disabled={createKey.isPending} type="submit">
            {t('settings.apiKeys.create')}
          </Button>
        </form>
      </SettingsSection>

      <SettingsSection>
        <div className="flex flex-col divide-y divide-border">
          {(keys ?? []).map((key) => (
            <div className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0" key={key.id}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <KeyRound className="size-4" />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-sm">{key.name}</div>
                  <div className="text-muted-foreground text-xs">
                    {key.revokedAt ? t('settings.apiKeys.revoked') : t('settings.apiKeys.lastFour', { lastFour: key.lastFour })}
                  </div>
                </div>
              </div>
              {!key.revokedAt ? (
                <Button
                  disabled={revokeKey.isPending}
                  onClick={() =>
                    revokeKey.mutate(key.id, {
                      onSuccess: () => toast.success(t('settings.apiKeys.revokedToast')),
                      onError: (error) => toast.error(error instanceof Error ? error.message : t('settings.apiKeys.revokeError')),
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  {t('settings.apiKeys.revoke')}
                </Button>
              ) : null}
            </div>
          ))}
          {(keys ?? []).length === 0 ? <p className="py-2 text-muted-foreground text-sm">{t('settings.apiKeys.empty')}</p> : null}
        </div>
      </SettingsSection>
    </div>
  );
}
