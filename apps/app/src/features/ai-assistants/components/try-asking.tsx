import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { CopyButton } from '@nibleaf/design-system/components/ui/copy-button';
import { useLocale } from '@nibleaf/i18n/react';
import { ExternalLink } from 'lucide-react';
import { docsUrl } from '@/lib/docs-url';
import { examplePrompts } from '../model/prompts';

/** What to ask once an assistant is connected, each with the permission it needs. */
export function TryAsking() {
  const { locale, t } = useLocale();
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ul className="flex min-w-0 flex-col divide-y divide-border">
        {examplePrompts().map(({ id, preset }) => {
          const text = t(`settings.aiAssistants.prompt.${id}`);
          return (
            <li className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center" key={id}>
              <p className="min-w-0 flex-1 text-sm">“{text}”</p>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant="outline">{t('settings.aiAssistants.needs', { permission: t(`settings.apiKeys.${preset}`) })}</Badge>
                <CopyButton
                  copiedLabel={t('settings.aiAssistants.promptCopied')}
                  failedLabel={t('settings.apiKeys.copyFailed')}
                  label={t('settings.aiAssistants.copyPrompt')}
                  value={text}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-muted-foreground text-sm">{t('settings.aiAssistants.safety')}</p>
      <a
        className="inline-flex items-center gap-1 self-start text-primary text-sm underline-offset-4 hover:underline"
        href={docsUrl(locale, 'product/ai-assistants')}
        rel="noreferrer"
        target="_blank"
      >
        {t('settings.aiAssistants.moreExamples')}
        <ExternalLink aria-hidden className="size-3.5" />
      </a>
    </div>
  );
}
