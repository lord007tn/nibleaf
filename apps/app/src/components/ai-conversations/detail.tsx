import { Badge } from '@nibleaf/design-system/components/ui/badge';

import { Button } from '@nibleaf/design-system/components/ui/button';

import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';

import { useDirection } from '@nibleaf/design-system/components/ui/direction';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';

import { Skeleton, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';

import { useT } from '@nibleaf/i18n/react';

import { canAdminister } from '@nibleaf/shared/rbac';

import { toast } from 'sonner';

import { useProjectMembers } from '@/hooks/api';

import { useAiConversation, useDeleteAiConversation } from '@/hooks/api/ai-conversations';

import { useFormatters } from '@/lib/format';

import { useSession } from '@/services/auth-client';
import { TranscriptAnswer, transcriptSourceHref } from './transcript';

export function DeleteConversationButton({ allowed, pending, onDelete }: { allowed: boolean; pending: boolean; onDelete: () => void }) {
  const t = useT();
  return allowed ? (
    <Button variant="destructive" loading={pending} onClick={onDelete}>
      {t('dashboard.ai.delete')}
    </Button>
  ) : null;
}

export function ConversationDetail({ projectId, conversation, onClose }: { projectId: string; conversation?: string; onClose: () => void }) {
  const t = useT();
  const f = useFormatters();
  const direction = useDirection();
  const confirm = useConfirm();

  const detail = useAiConversation(projectId, conversation);
  const deletion = useDeleteAiConversation(projectId);

  const members = useProjectMembers(projectId);
  const { data: session } = useSession();

  const allowed = !members.isError && canAdminister(members.data?.members.find((member) => member.user.id === session?.user.id)?.role ?? '');

  async function remove() {
    if (
      !conversation ||
      !(await confirm({
        title: t('dashboard.ai.delete'),
        description: t('dashboard.ai.deleteConfirm'),
        confirmLabel: t('dashboard.ai.delete'),
        destructive: true,
      }))
    )
      return;

    try {
      await deletion.mutateAsync(conversation);
      onClose();
    } catch {
      toast.error(t('dashboard.ai.deleteError'));
    }
  }

  return (
    <Sheet
      open={Boolean(conversation)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent side={direction === 'rtl' ? 'left' : 'right'} className="w-full overflow-y-auto sm:max-w-2xl" closeLabel={t('common.cancel')}>
        <SheetHeader>
          <SheetTitle>{t('dashboard.ai.conversations')}</SheetTitle>
          <SheetDescription>{detail.data ? f.dateTime(detail.data.startedAt) : t('dashboard.ai.subtitle')}</SheetDescription>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-6">
          {detail.isPending ? (
            <div aria-busy="true" className="space-y-6">
              <p className="sr-only" role="status">
                {t('common.loading')}
              </p>
              {['first', 'second'].map((id) => (
                <div aria-hidden key={id} className="space-y-3 border-b pb-6">
                  <Skeleton className="ms-8 h-14 rounded-xl" />
                  <Skeleton className="h-5 w-20" />
                  <SkeletonText lines={3} />
                </div>
              ))}
            </div>
          ) : detail.isError ? (
            <p role="alert">{t('dashboard.ai.missing')}</p>
          ) : detail.data ? (
            <>
              {detail.data.visibility === 'private' && <Badge variant="outline">{t('dashboard.ai.private')}</Badge>}
              {detail.data.turns.map((turn) => (
                <article key={turn.turnId} className="space-y-3 border-b pb-6">
                  <p dir="auto" className="ms-8 whitespace-pre-wrap rounded-xl bg-muted p-4">
                    {turn.question ?? t('dashboard.ai.notSaved')}
                  </p>
                  <Badge variant={turn.status === 'failed' ? 'destructive' : 'secondary'}>{t(`dashboard.ai.${turn.status}`)}</Badge>
                  <div
                    dir="auto"
                    className="min-w-0 space-y-2 break-words text-sm leading-7 [&_li]:ms-5 [&_ol]:list-decimal [&_pre]:overflow-x-auto [&_ul]:list-disc"
                  >
                    <TranscriptAnswer
                      answer={turn.answer ?? t('dashboard.ai.answerNotSaved')}
                      citations={turn.citations}
                      projectId={projectId}
                      language={turn.language}
                      version={turn.version}
                    />
                  </div>
                  {turn.citations.length > 0 && (
                    <div>
                      <h3 className="font-medium text-sm">{t('dashboard.ai.sources')}</h3>
                      {turn.citations.map((source, index) => (
                        <a
                          className="mt-2 block rounded border p-3 text-sm underline"
                          key={source.id}
                          href={transcriptSourceHref(projectId, source, turn.language, turn.version)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {index + 1}. {source.title}
                          {source.heading && ` — ${source.heading}`}
                        </a>
                      ))}
                    </div>
                  )}
                  {turn.feedback && (
                    <section className="rounded border p-3 text-sm">
                      <h3 className="font-medium">{t('dashboard.ai.feedback')}</h3>
                      <p>
                        {t(`dashboard.ai.${turn.feedback.rating}`)}
                        {turn.feedback.reason && ` · ${t(`dashboard.ai.${turn.feedback.reason}`)}`}
                      </p>
                      {turn.feedback.comment && (
                        <p className="mt-2 whitespace-pre-wrap" dir="auto">
                          {turn.feedback.comment}
                        </p>
                      )}
                    </section>
                  )}
                  <details className="text-sm">
                    <summary className="cursor-pointer">{t('dashboard.ai.details')}</summary>
                    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                      {[
                        [t('dashboard.ai.rewritten'), turn.rewrittenQuery],
                        [t('dashboard.ai.provider'), turn.provider],
                        [t('dashboard.ai.model'), turn.model],
                        [
                          t('dashboard.ai.tokens'),
                          `${turn.inputTokens === null ? '—' : f.number(turn.inputTokens)} / ${turn.outputTokens === null ? '—' : f.number(turn.outputTokens)}`,
                        ],
                        [t('dashboard.ai.cost'), turn.costUsd === null ? t('dashboard.ai.unknownCost') : f.usd(turn.costUsd)],
                        [t('dashboard.ai.latency'), turn.latencyMs === null ? '—' : f.number(turn.latencyMs)],
                      ].map(([label, value]) => (
                        <div className="contents" key={label}>
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="min-w-0 break-words" dir="auto">
                            {value ?? '—'}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </article>
              ))}
              <DeleteConversationButton allowed={allowed} pending={deletion.isPending} onDelete={() => void remove()} />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
