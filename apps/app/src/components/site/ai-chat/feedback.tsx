import { Button } from '@nibleaf/design-system/components/ui/button';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { siteT } from '@nibleaf/i18n/site';
import type { AiChatConsent, AiChatFeedbackReason, AiChatFinalEvent } from '@nibleaf/validators';
import { useState } from 'react';
import { submitChatFeedbackFn } from '@/functions/site-chat';

const reasons = [
  ['incorrect', 'aiIncorrect'],
  ['incomplete', 'aiIncomplete'],
  ['not_relevant', 'aiNotRelevant'],
  ['hard_to_understand', 'aiHard'],
  ['outdated', 'aiOutdated'],
  ['other', 'aiOther'],
] as const;
export function Feedback({ final, projectId, lang, consent }: { final: AiChatFinalEvent; projectId: string; lang?: string; consent: AiChatConsent }) {
  const t = siteT(lang);
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [reason, setReason] = useState<AiChatFeedbackReason>();
  const [comment, setComment] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const save = async (next: 'up' | 'down') => {
    setState('saving');
    try {
      await submitChatFeedbackFn({
        data: {
          projectId,
          conversationId: final.conversationId,
          turnId: final.turnId,
          token: final.feedbackToken,
          rating: next,
          ...(next === 'down' ? { reason, comment } : {}),
          consent,
          lang,
        },
      });
      setRating(next);
      setState('saved');
    } catch {
      setState('error');
    }
  };
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button size="sm" variant="outline" aria-pressed={rating === 'up'} disabled={state === 'saving'} onClick={() => void save('up')}>
          {t('aiUp')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={rating === 'down'}
          disabled={state === 'saving'}
          onClick={() => {
            setRating('down');
            setState('idle');
          }}
        >
          {t('aiDown')}
        </Button>
      </div>
      {rating === 'down' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {reasons.map(([value, key]) => (
              <Button
                key={value}
                size="sm"
                variant="outline"
                aria-pressed={reason === value}
                onClick={() => {
                  setReason(value);
                  setState('idle');
                }}
              >
                {t(key)}
              </Button>
            ))}
          </div>
          <Textarea
            maxLength={1000}
            aria-label={t('aiComment')}
            placeholder={t('aiComment')}
            value={comment}
            onChange={(event) => {
              setComment(event.target.value);
              setState('idle');
            }}
          />
          <Button size="sm" disabled={state === 'saving'} onClick={() => void save('down')}>
            {t('aiSend')}
          </Button>
        </div>
      )}
      {state === 'saved' && <p role="status">{t('aiThanks')}</p>}
      {state === 'error' && <p role="alert">{t('aiFailed')}</p>}
    </div>
  );
}
