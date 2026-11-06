import { Button } from '@nibleaf/design-system/components/ui/button';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { siteChatT } from '@nibleaf/i18n/site-chat';
import { useEffect, useRef, useState } from 'react';
/** Text to put in the field for the reader to edit and send (a new `id` each time). */
export interface ComposerDraft {
  id: number;
  text: string;
}
export function Composer({
  lang,
  busy,
  send,
  stop,
  draft,
  onDraftApplied,
}: {
  lang?: string;
  busy: boolean;
  send: (question: string) => void;
  stop: () => void;
  draft?: ComposerDraft;
  /** Called once the draft is in the field, so it is not applied again. */
  onDraftApplied?: () => void;
}) {
  const [value, setValue] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!draft) return;
    setValue(draft.text);
    field.current?.focus();
    onDraftApplied?.();
  }, [draft, onDraftApplied]);
  const t = siteChatT(lang);
  const submit = () => {
    if (busy || value.trim().length < 2) return;
    send(value.trim());
    setValue('');
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="space-y-2"
    >
      <Textarea
        ref={field}
        className="max-h-40 min-h-16 resize-none overflow-y-auto"
        maxLength={500}
        value={value}
        aria-label={t('aiQuestion')}
        placeholder={t('aiQuestion')}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="flex items-center justify-end gap-3">
        {value.length >= 450 && <span className="text-muted-foreground text-xs">{value.length}/500</span>}
        {busy ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              stop();
              // The Stop button goes away; keep focus in the composer.
              field.current?.focus();
            }}
          >
            {t('aiStop')}
          </Button>
        ) : (
          <Button type="submit" disabled={value.trim().length < 2}>
            {t('aiSend')}
          </Button>
        )}
      </div>
    </form>
  );
}
