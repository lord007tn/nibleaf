import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import type { AiContentGap } from '@nibleaf/validators';
import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { useFormatters } from '@/lib/format';
export function GapList({ items, onOpen, onWrite }: { items: AiContentGap[]; onOpen: (id: string) => void; onWrite: (question: string) => void }) {
  const t = useT();
  const f = useFormatters();
  return (
    <div className="space-y-4">
      {items.map((gap) => (
        <article className="space-y-3 rounded-xl border bg-card p-5" key={`${gap.language}:${gap.question}`}>
          <h2 className="font-medium" dir="auto">
            {gap.question}
          </h2>
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-muted-foreground text-sm">
            {[
              [t('dashboard.ai.asked'), f.number(gap.askedCount)],
              [t('dashboard.ai.no_answer'), f.number(gap.noAnswerCount)],
              [t('dashboard.ai.down'), f.number(gap.downCount)],
              [t('dashboard.ai.language'), gap.language],
              [t('dashboard.ai.lastAsked'), f.dateTime(gap.lastAskedAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => onWrite(gap.question)}>
              {t('dashboard.ai.write')}
            </Button>
            <Button variant="ghost" onClick={() => onOpen(gap.sampleConversationId)}>
              {t('dashboard.ai.view')}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}
export function ContentGaps({ projectId, items, onOpen }: { projectId: string; items: AiContentGap[]; onOpen: (id: string) => void }) {
  const t = useT();
  const navigate = useNavigate();
  async function write(question: string) {
    try {
      await navigator.clipboard.writeText(question);
    } catch {
      toast.error(t('dashboard.ai.copyError'));
      return;
    }
    toast.success(t('dashboard.ai.copied'));
    await navigate({ to: '/app/projects/$projectId/editor', params: { projectId } });
  }
  return <GapList items={items} onOpen={onOpen} onWrite={(question) => void write(question)} />;
}
