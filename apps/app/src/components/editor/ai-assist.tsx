import { Button } from '@nibleaf/design-system/components/ui/button';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { ArrowDownToLine, Check, Replace, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AiAction, AiAssistSession } from './use-ai-assist-session';

/** Shown on the clicked button while the assistant works. */
const WORKING: Record<AiAction, MessageKey> = {
  continue: 'editor.ai.drafting',
  rephrase: 'editor.ai.rephrasing',
  outline: 'editor.ai.outlining',
  summarize: 'editor.ai.summarizing',
  instruction: 'editor.ai.drafting',
};

interface AiAssistProps {
  session: AiAssistSession;
  /** Whose AI drafts here: the site's own Smart AI connection, or the server's key. */
  source?: { source: 'workspace' | 'instance' | null; provider: 'openai' | 'openrouter' | null } | null;
}

const PROVIDER_NAMES = { openai: 'OpenAI', openrouter: 'OpenRouter' } as const;

/** The route owns requests and previews; this card can unmount with the rail. */
export function AiAssist({ session, source }: AiAssistProps) {
  const t = useT();
  const [instruction, setInstruction] = useState('');
  const { pending, running, preview, run, busyElsewhere, trackCard } = session;
  // While the card is on screen, a draft that lands here is seen without a toast.
  useEffect(trackCard, [trackCard]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2.5 border-border border-b px-4 py-3.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <span className="font-semibold text-sm">{t('editor.ai.title')}</span>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-muted-foreground text-sm leading-relaxed">{t('editor.ai.intro')}</p>
        {source?.source === 'workspace' && source.provider ? (
          <p className="text-muted-foreground text-xs" data-testid="ai-source">
            {t('editor.ai.source.site', { provider: PROVIDER_NAMES[source.provider] })}
          </p>
        ) : source?.source === 'instance' ? (
          <p className="text-muted-foreground text-xs" data-testid="ai-source">
            {t('editor.ai.source.instance')}
          </p>
        ) : null}
        {busyElsewhere ? (
          <p aria-hidden="true" className="text-muted-foreground text-sm">
            {t('editor.ai.busyOtherPage')}
          </p>
        ) : null}
        {/* A live region must exist before its text changes to be announced, so it is always rendered. */}
        <p className="sr-only" role="status">
          {busyElsewhere ? t('editor.ai.busyOtherPage') : ''}
        </p>

        <div className="space-y-2">
          <Button
            className="w-full justify-start"
            disabled={pending}
            loading={running === 'continue'}
            loadingText={t(WORKING.continue)}
            onClick={() => run('continue')}
          >
            <Sparkles className="size-4" /> {t('editor.ai.continue')}
          </Button>
          <div className="grid grid-cols-1 gap-2">
            <Button
              className="w-full justify-start whitespace-normal text-start leading-snug"
              disabled={pending}
              loading={running === 'rephrase'}
              loadingText={t(WORKING.rephrase)}
              onClick={() => run('rephrase')}
              size="sm"
              variant="outline"
            >
              {t('editor.ai.rephrase')}
            </Button>
            <Button
              className="w-full justify-start whitespace-normal text-start leading-snug"
              disabled={pending}
              loading={running === 'outline'}
              loadingText={t(WORKING.outline)}
              onClick={() => run('outline')}
              size="sm"
              variant="outline"
            >
              {t('editor.ai.outline')}
            </Button>
            <Button
              className="w-full justify-start whitespace-normal text-start leading-snug"
              disabled={pending}
              loading={running === 'summarize'}
              loadingText={t(WORKING.summarize)}
              onClick={() => run('summarize')}
              size="sm"
              variant="outline"
            >
              {t('editor.ai.summarize')}
            </Button>
          </div>
        </div>

        {preview ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              <Wand2 className="size-3" />
              {preview.mode === 'summarize' ? t('editor.ai.summaryLabel') : t('editor.ai.suggestionLabel')}
            </div>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-foreground/90 text-sm leading-relaxed" dir="auto">
              {preview.text}
            </p>
            <div className="grid grid-cols-1 gap-2">
              <Button className="w-full justify-start whitespace-normal text-start" disabled={pending} onClick={session.replace} size="sm">
                <Replace className="size-3.5" /> {t('editor.ai.replace')}
              </Button>
              <Button
                className="w-full justify-start whitespace-normal text-start"
                disabled={pending}
                onClick={session.insert}
                size="sm"
                variant="outline"
              >
                <ArrowDownToLine className="size-3.5" /> {t('editor.ai.insert')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-2 border-border border-t pt-3">
          <Textarea
            className="min-h-[64px] resize-none text-sm"
            disabled={pending}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={t('editor.ai.instructionPlaceholder')}
            value={instruction}
          />
          <Button
            className="w-full"
            disabled={pending || !instruction.trim()}
            loading={running === 'instruction'}
            loadingText={t(WORKING.instruction)}
            onClick={() => run('instruction', instruction.trim())}
            variant="secondary"
          >
            <Check className="size-4" />
            {t('editor.ai.generate')}
          </Button>
        </div>
      </div>
    </div>
  );
}
