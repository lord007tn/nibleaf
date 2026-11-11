import { Button } from '@nibleaf/design-system/components/ui/button';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { siteChatT } from '@nibleaf/i18n/site-chat';
import { Loader2Icon, SendHorizontal, Square } from 'lucide-react';
import type { RefObject } from 'react';

/** The question field, with its send button inline at the end. While an answer
 * is on its way the same slot holds Stop, with a spinner, so nothing moves.
 * Its text is the panel's, so it survives the panel closing. */
export function Composer({
  lang,
  busy,
  value,
  setValue,
  field,
  send,
  stop,
}: {
  lang?: string;
  busy: boolean;
  value: string;
  setValue: (value: string) => void;
  field: RefObject<HTMLTextAreaElement | null>;
  send: (question: string) => void;
  stop: () => void;
}) {
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
      className="flex items-end gap-2"
    >
      <div className="relative min-w-0 flex-1">
        <Textarea
          ref={field}
          rows={1}
          className="max-h-40 min-h-11 resize-none overflow-y-auto"
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
        {/* By 450 characters the field is at its full height, so the count
            sits over its corner without changing the layout. */}
        {value.length >= 450 && (
          <span className="pointer-events-none absolute end-3 bottom-1 rounded bg-background/90 px-1 text-muted-foreground text-xs">
            {value.length}/500
          </span>
        )}
      </div>
      {/* Send and Stop share one fixed-size slot. */}
      {busy ? (
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-busy="true"
          className="relative shrink-0 rounded-full"
          onClick={() => {
            stop();
            // The Stop button goes away; keep focus in the composer.
            field.current?.focus();
          }}
        >
          <Loader2Icon aria-hidden className="absolute inset-0 size-full animate-spin p-0.5 text-muted-foreground motion-reduce:animate-none" />
          <Square aria-hidden className="size-3 fill-current" />
          <span className="sr-only">{t('aiStop')}</span>
        </Button>
      ) : (
        <Button type="submit" size="icon-lg" className="shrink-0 rounded-full" disabled={value.trim().length < 2}>
          {/* The arrow points the way the text runs. */}
          <SendHorizontal aria-hidden className="rtl:-scale-x-100" />
          <span className="sr-only">{t('aiSend')}</span>
        </Button>
      )}
    </form>
  );
}
