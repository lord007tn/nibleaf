import { Button } from '@nibleaf/design-system/components/ui/button';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { siteChatT } from '@nibleaf/i18n/site-chat';
import type { AiChatConsent, AiChatFeedbackRating, AiChatFeedbackReason, AiChatFinalEvent } from '@nibleaf/validators';
import { useMutation } from '@tanstack/react-query';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { submitChatFeedbackFn } from '@/functions/site-chat';

const reasons = [
  ['incorrect', 'aiIncorrect'],
  ['incomplete', 'aiIncomplete'],
  ['not_relevant', 'aiNotRelevant'],
  ['hard_to_understand', 'aiHard'],
  ['outdated', 'aiOutdated'],
  ['other', 'aiOther'],
] as const;
const pressed = 'aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary';

type Rating = AiChatFeedbackRating | null;
interface FeedbackInput {
  rating: Rating;
  reason?: AiChatFeedbackReason;
  comment?: string;
}

/** Thumbs show the reader's choice at once and roll back if saving fails.
 * Pressing the active thumb withdraws the rating; a thumbs-down can add a
 * reason and comment afterwards. */
export function Feedback({
  final,
  projectId,
  lang,
  consent,
  leading,
}: {
  final: AiChatFinalEvent;
  projectId: string;
  lang?: string;
  consent: AiChatConsent;
  leading?: ReactNode;
}) {
  const t = siteChatT(lang);
  const [rating, setRating] = useState<Rating>(null);
  // The rating the server last confirmed, sent as `previousRating`.
  const saved = useRef<Rating>(null);
  const [reason, setReason] = useState<AiChatFeedbackReason>();
  const [comment, setComment] = useState('');
  const [details, setDetails] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  // Which control started the save in flight, for its loading state.
  const [origin, setOrigin] = useState<AiChatFeedbackRating | 'details'>();
  const mutation = useMutation({
    mutationFn: (input: FeedbackInput) =>
      submitChatFeedbackFn({
        data: {
          projectId,
          conversationId: final.conversationId,
          turnId: final.turnId,
          token: final.feedbackToken,
          rating: input.rating,
          ...(input.reason ? { reason: input.reason } : {}),
          ...(input.comment ? { comment: input.comment } : {}),
          ...(saved.current ? { previousRating: saved.current } : {}),
          consent,
          lang,
        },
      }),
    onMutate: (input) => {
      const rollback = { rating, details };
      setRating(input.rating);
      setStatus('idle');
      return rollback;
    },
    onError: (_error, _input, rollback) => {
      setRating(rollback?.rating ?? null);
      setDetails(rollback?.details ?? false);
      setStatus('error');
    },
    onSuccess: (_result, input) => {
      saved.current = input.rating;
      setStatus(input.rating ? 'saved' : 'idle');
    },
  });
  const rate = (next: AiChatFeedbackRating) => {
    const target = rating === next ? null : next;
    setDetails(target === 'down');
    setOrigin(next);
    mutation.mutate({ rating: target });
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        {leading}
        <Button
          size="icon"
          variant="ghost"
          className={pressed}
          aria-label={t('aiUp')}
          title={t('aiUp')}
          aria-pressed={rating === 'up'}
          loading={mutation.isPending && origin === 'up'}
          disabled={mutation.isPending}
          onClick={() => rate('up')}
        >
          <ThumbsUp aria-hidden className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className={pressed}
          aria-label={t('aiDown')}
          title={t('aiDown')}
          aria-pressed={rating === 'down'}
          loading={mutation.isPending && origin === 'down'}
          disabled={mutation.isPending}
          onClick={() => rate('down')}
        >
          <ThumbsDown aria-hidden className="size-4" />
        </Button>
      </div>
      {details && rating === 'down' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {reasons.map(([value, key]) => (
              <Button
                key={value}
                size="sm"
                variant="outline"
                className={pressed}
                aria-pressed={reason === value}
                onClick={() => setReason(reason === value ? undefined : value)}
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
            onChange={(event) => setComment(event.target.value)}
          />
          <Button
            size="sm"
            // Details wait for the rating's own save, so the two writes never cross.
            disabled={(mutation.isPending && origin !== 'details') || (!reason && !comment.trim())}
            loading={mutation.isPending && origin === 'details'}
            onClick={() => {
              setOrigin('details');
              mutation.mutate({ rating: 'down', reason, comment: comment.trim() || undefined }, { onSuccess: () => setDetails(false) });
            }}
          >
            {t('aiSend')}
          </Button>
        </div>
      )}
      {status === 'saved' && <p role="status">{t('aiThanks')}</p>}
      {status === 'error' && <p role="alert">{t('aiFailed')}</p>}
    </div>
  );
}
