import { Button } from '@nibleaf/design-system/components/ui/button';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { siteChatT } from '@nibleaf/i18n/site-chat';
import { useState } from 'react';
export function Composer({ lang, busy, send, stop }: { lang?: string; busy: boolean; send: (question: string) => void; stop: () => void }) {
  const [value, setValue] = useState('');
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
          <Button type="button" variant="outline" onClick={stop}>
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
