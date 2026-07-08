import { Button } from '@nibleaf/design-system/components/ui/button';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { cn } from '@nibleaf/design-system/lib/utils';
import { ArrowDownToLine, Check, Loader2, Replace, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAiDraft } from '@/hooks/api';
import { useT } from '@/lib/i18n';

type AiMode = 'continue' | 'rephrase' | 'outline' | 'summarize';

interface AiAssistProps {
  projectId: string;
  /** Current editor content (Markdown source). */
  content: string;
  /** Persisted setter — updating this triggers the editor's autosave. */
  onContentChange: (next: string) => void;
}

/** Append-style modes write straight back into the doc; transform modes show a preview first. */
const APPEND_MODES = new Set<AiMode>(['continue', 'outline']);

/**
 * AI assist card. Calls `useAiDraft(projectId)` with the live editor content.
 * For continue/outline the result is appended to the doc (so autosave persists it);
 * for rephrase/summarize the result lands in a preview box with Replace / Insert actions.
 */
export function AiAssist({ projectId, content, onContentChange }: AiAssistProps) {
  const t = useT();
  const ai = useAiDraft(projectId);
  const [instruction, setInstruction] = useState('');
  const [activeMode, setActiveMode] = useState<AiMode | null>(null);
  // Preview for transform modes (rephrase/summarize) — kept until the user acts on it.
  const [preview, setPreview] = useState<{ mode: AiMode; text: string } | null>(null);

  const appendToDoc = (text: string) => {
    const trimmed = content.replace(/\s+$/, '');
    const next = trimmed ? `${trimmed}\n\n${text.trim()}` : text.trim();
    onContentChange(next);
  };

  const run = (mode: AiMode, opts?: { instruction?: string }) => {
    setActiveMode(mode);
    setPreview(null);
    ai.mutate(
      { mode, content, ...(opts?.instruction ? { instruction: opts.instruction } : {}) },
      {
        onSuccess: (result) => {
          if (!result.text?.trim()) {
            toast.message(t('editor.ai.empty'));
            return;
          }
          if (APPEND_MODES.has(mode)) {
            appendToDoc(result.text);
            toast.success(mode === 'outline' ? t('editor.ai.outlineAdded') : t('editor.ai.sectionDrafted'));
          } else {
            setPreview({ mode, text: result.text });
          }
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.ai.draftError')),
        onSettled: () => setActiveMode(null),
      },
    );
  };

  const pending = ai.isPending;

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

        {pending ? (
          <div className="flex items-center gap-2.5 rounded-lg bg-accent px-3 py-2.5 font-medium text-accent-foreground text-sm">
            <Loader2 className="size-3.5 animate-spin" />
            {activeMode === 'rephrase'
              ? t('editor.ai.rephrasing')
              : activeMode === 'summarize'
                ? t('editor.ai.summarizing')
                : activeMode === 'outline'
                  ? t('editor.ai.outlining')
                  : t('editor.ai.drafting')}
          </div>
        ) : (
          <div className="space-y-2">
            <Button className="w-full justify-start" disabled={pending} onClick={() => run('continue')}>
              <Sparkles className="size-4" /> {t('editor.ai.continue')}
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button disabled={pending} onClick={() => run('rephrase')} size="sm" variant="outline">
                {t('editor.ai.rephrase')}
              </Button>
              <Button disabled={pending} onClick={() => run('outline')} size="sm" variant="outline">
                {t('editor.ai.outline')}
              </Button>
              <Button disabled={pending} onClick={() => run('summarize')} size="sm" variant="outline">
                {t('editor.ai.summarize')}
              </Button>
            </div>
          </div>
        )}

        {preview ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              <Wand2 className="size-3" />
              {preview.mode === 'summarize' ? t('editor.ai.summaryLabel') : t('editor.ai.suggestionLabel')}
            </div>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-foreground/90 text-sm leading-relaxed">{preview.text}</p>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => {
                  onContentChange(preview.text.trim());
                  setPreview(null);
                  toast.success(t('editor.ai.replaced'));
                }}
                size="sm"
              >
                <Replace className="size-3.5" /> {t('editor.ai.replace')}
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  appendToDoc(preview.text);
                  setPreview(null);
                  toast.success(t('editor.ai.inserted'));
                }}
                size="sm"
                variant="outline"
              >
                <ArrowDownToLine className="size-3.5" /> {t('editor.ai.insert')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className={cn('space-y-2 border-border border-t pt-3', pending && 'pointer-events-none opacity-60')}>
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
            onClick={() => run('continue', { instruction: instruction.trim() })}
            variant="secondary"
          >
            {pending && activeMode === 'continue' ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            {t('editor.ai.generate')}
          </Button>
        </div>
      </div>
    </div>
  );
}
