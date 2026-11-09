import { Button } from '@nibleaf/design-system/components/ui/button';
import { useLocale, useT } from '@nibleaf/i18n/react';
import type { AiContentGap } from '@nibleaf/validators';
import type { ReactNode } from 'react';
import { WriteArticleButton } from '@/components/analytics/insights/search-terms';
import { useLanguages } from '@/hooks/api';
import { useFormatters } from '@/lib/format';
import { languageName } from '@/lib/language-name';

/** Questions readers asked that the docs couldn't answer, each with a way to write the missing article. */
export function GapList({
  items,
  onOpen,
  writeAction,
  languageLabel = (code) => code,
}: {
  items: AiContentGap[];
  onOpen: (id: string) => void;
  /** The "write an article" control for one gap. */
  writeAction: (gap: AiContentGap) => ReactNode;
  /** A readable name for a content language code. */
  languageLabel?: (code: string) => string;
}) {
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
              [t('dashboard.ai.language'), languageLabel(gap.language)],
              [t('dashboard.ai.lastAsked'), f.dateTime(gap.lastAskedAt)],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            {writeAction(gap)}
            <Button variant="ghost" onClick={() => onOpen(gap.sampleConversationId)}>
              {t('dashboard.ai.view')}
            </Button>
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Content gaps for one site. "Write an article about this" creates a draft
 * titled with the question, in the question's language, and opens it in the
 * editor (the same flow as the search report's terms), instead of copying the
 * question and leaving the writer in an empty editor.
 */
export function ContentGaps({ projectId, items, onOpen }: { projectId: string; items: AiContentGap[]; onOpen: (id: string) => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { data: siteLanguages } = useLanguages(projectId);
  return (
    <GapList
      items={items}
      languageLabel={(code) => languageName(code, siteLanguages, locale)}
      onOpen={onOpen}
      writeAction={(gap) => (
        <WriteArticleButton
          content={gap.question}
          label={t('dashboard.ai.write')}
          languageCode={gap.language}
          projectId={projectId}
          term={gap.question}
        />
      )}
    />
  );
}
