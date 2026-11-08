import { useT } from '@nibleaf/i18n/react';
import type { AiConversationSummary } from '@nibleaf/validators';
import { useMemo } from 'react';
import { localIsoDay } from '@/components/analytics/insights/filters';
import { TrendChart, useSeriesSummary } from '@/components/analytics/insights/trend-chart';
import { ListCard } from '@/components/analytics/list-card';
import { useFormatters } from '@/lib/format';

export function CostValue({ usage }: { usage: AiConversationSummary['usage'] }) {
  const t = useT();
  const f = useFormatters();
  return (
    <>
      {usage.costUsd === null
        ? t('dashboard.ai.unknownCost')
        : usage.costComplete
          ? f.usd(usage.costUsd)
          : t('dashboard.ai.atLeast', { cost: f.usd(usage.costUsd) })}
    </>
  );
}
type DailyPoint = AiConversationSummary['timeseries'][number];

/**
 * The summary only returns days that had questions. Plotted as-is, a quiet
 * week vanishes and the axis jumps from Oct 17 to Oct 21 as if they were
 * neighbours. Fill every missing calendar day from the first bucket through
 * today (the viewer's calendar) with zero activity and zero spend.
 */
export function fillDailyGaps(points: readonly DailyPoint[], today = localIsoDay(new Date())): DailyPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0];
  if (!first) return [];
  const byDate = new Map(sorted.map((point) => [point.date, point]));
  const last = sorted.at(-1)?.date ?? first.date;
  const end = last > today ? last : today;
  const filled: DailyPoint[] = [];
  // Noon avoids DST edges when stepping one calendar day at a time.
  for (let day = new Date(`${first.date}T12:00:00`); localIsoDay(day) <= end; day.setDate(day.getDate() + 1)) {
    const date = localIsoDay(day);
    filled.push(byDate.get(date) ?? { date, questions: 0, answered: 0, noAnswer: 0, up: 0, down: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
  }
  return filled;
}

export function Overview({ data }: { data: AiConversationSummary }) {
  const t = useT();
  const f = useFormatters();
  const totalRated = data.feedback.up + data.feedback.down;
  const daily = useMemo(() => fillDailyGaps(data.timeseries), [data.timeseries]);
  // Decided from the real buckets: zero-filled quiet days must not turn "cost unknown" into "$0".
  const costKnown = data.timeseries.some((point) => point.costUsd !== null);
  const cards = [
    { label: t('dashboard.ai.questions'), value: f.number(data.totals.questions) },
    {
      label: t('dashboard.ai.answered'),
      value: f.number(data.totals.answered),
      hint: t('dashboard.ai.answerRate', {
        rate: data.totals.questions ? f.number(data.totals.answered / data.totals.questions, { style: 'percent', maximumFractionDigits: 1 }) : '—',
      }),
    },
    { label: t('dashboard.ai.no_answer'), value: f.number(data.totals.noAnswer) },
    {
      label: t('dashboard.ai.satisfaction'),
      value: totalRated ? f.number(data.feedback.up / totalRated, { style: 'percent', maximumFractionDigits: 1 }) : '—',
      hint: t('dashboard.ai.votes', { up: f.number(data.feedback.up), down: f.number(data.feedback.down) }),
    },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border bg-card p-5">
            <p className="text-muted-foreground text-sm">{card.label}</p>
            <p className="mt-2 font-semibold text-2xl tabular-nums">{card.value}</p>
            {card.hint && <p className="mt-1 text-muted-foreground text-xs">{card.hint}</p>}
          </div>
        ))}
      </div>
      <div className="rounded-xl border bg-card p-5">
        <p className="text-muted-foreground text-sm">{t('dashboard.ai.cost')}</p>
        <p className="mt-2 font-semibold text-xl">
          <CostValue usage={data.usage} />
        </p>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer">{t('dashboard.ai.details')}</summary>
          <p>
            {t('dashboard.ai.tokens')}: {f.number(data.usage.inputTokens + data.usage.outputTokens)}
          </p>
        </details>
      </div>
      <Engagement data={data.engagement} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Series data={daily} kind="questions" />
        <Series costKnown={costKnown} data={daily} kind="cost" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-medium text-sm">{t('dashboard.ai.feedback')}</h2>
          {data.feedback.reasons.map((reason) => (
            <div className="mb-3" key={reason.reason}>
              <div className="flex justify-between gap-3 text-sm">
                <span>{t(`dashboard.ai.${reason.reason}`)}</span>
                <span>{f.number(reason.count)}</span>
              </div>
              <div className="mt-1 h-2 rounded bg-muted">
                <div className="h-full rounded bg-primary" style={{ width: `${totalRated ? (reason.count / totalRated) * 100 : 0}%` }} />
              </div>
            </div>
          ))}
          {data.feedback.reasons.length === 0 && <p className="text-muted-foreground text-sm">{t('dashboard.ai.empty')}</p>}
        </div>
        <ListCard
          title={t('dashboard.ai.languages')}
          empty={t('dashboard.ai.empty')}
          items={data.languages.map((item) => ({ key: item.language, label: item.language, value: item.questions }))}
        />
      </div>
    </div>
  );
}
function Series({
  data,
  kind,
  costKnown = true,
}: {
  data: AiConversationSummary['timeseries'];
  kind: 'questions' | 'cost';
  /** At least one real day reported its cost (quiet, zero-filled days don't count). */
  costKnown?: boolean;
}) {
  const t = useT();
  const summarize = useSeriesSummary();
  const title = t(kind === 'questions' ? 'dashboard.ai.overTime' : 'dashboard.ai.costOverTime');
  const series =
    kind === 'questions'
      ? [
          { key: 'answered', label: t('dashboard.ai.answered'), color: 'var(--chart-1)' },
          { key: 'noAnswer', label: t('dashboard.ai.no_answer'), color: 'var(--chart-2)' },
        ]
      : [{ key: 'costUsd', label: t('dashboard.ai.cost'), color: 'var(--chart-1)' }];
  const tokenSeries = [
    { key: 'inputTokens', label: t('dashboard.ai.inputTokens'), color: 'var(--chart-1)' },
    { key: 'outputTokens', label: t('dashboard.ai.outputTokens'), color: 'var(--chart-3)' },
  ];
  // Screen-reader summaries describe the totals the stacked areas add up to.
  const questionTotals = data.map((point) => ({ bucket: point.date, value: point.answered + point.noAnswer }));
  const tokenTotals = data.map((point) => ({ bucket: point.date, value: point.inputTokens + point.outputTokens }));
  const costTotals = data.map((point) => ({ bucket: point.date, value: point.costUsd ?? 0 }));
  const unknownCost = kind === 'cost' && data.length > 0 && !costKnown;
  // Questions were asked but cost nothing: a flat $0 line is the truthful picture, not "no questions yet".
  const hadQuestions = data.some((point) => point.answered + point.noAnswer > 0);
  return (
    <section className="min-w-0 rounded-xl border bg-card p-5">
      <h2 className="mb-4 font-medium text-sm">{title}</h2>
      <TrendChart
        empty={t('dashboard.ai.empty')}
        granularity="day"
        rows={data}
        series={series}
        stacked={kind === 'questions'}
        showZeros={kind === 'cost' && hadQuestions}
        summary={kind === 'questions' ? summarize(title, questionTotals, 'day') : summarize(title, costTotals, 'day', 'usd')}
        unknown={unknownCost}
        valueKind={kind === 'cost' ? 'usd' : 'count'}
        xKey="date"
      />
      {kind === 'cost' && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm">{t('dashboard.ai.details')}</summary>
          <h3 className="my-2 text-sm">{t('dashboard.ai.usageOverTime')}</h3>
          <TrendChart
            empty={t('dashboard.ai.empty')}
            granularity="day"
            height="h-48"
            rows={data}
            series={tokenSeries}
            stacked
            summary={summarize(t('dashboard.ai.usageOverTime'), tokenTotals, 'day')}
            xKey="date"
          />
        </details>
      )}
    </section>
  );
}

export function Engagement({ data }: { data: AiConversationSummary['engagement'] }) {
  const t = useT();
  const f = useFormatters();
  const counts = [
    'opens',
    'citationClicks',
    'followUpClicks',
    'copies',
    'stops',
    'newChats',
    'feedbackGiven',
    'feedbackChanged',
    'quotaReached',
    'providerErrors',
  ] as const;
  return (
    <section className="space-y-4">
      <h2 className="font-medium">{t('dashboard.ai.engagement')}</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard
          title={t('dashboard.ai.readerActions')}
          empty={t('dashboard.ai.empty')}
          items={counts.map((key) => ({ key, label: t(`dashboard.ai.${key}`), value: data[key] }))}
        />
        <ListCard
          title={t('dashboard.ai.openSources')}
          empty={t('dashboard.ai.empty')}
          items={data.opensBySource.map((row) => ({ key: row.source, label: t(`dashboard.ai.${row.source}`), value: row.count }))}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {(['medianFirstTokenMs', 'medianLatencyMs'] as const).map((key) => (
          <div key={key} className="rounded-xl border bg-card p-5">
            <p className="text-muted-foreground text-sm">{t(`dashboard.ai.${key}`)}</p>
            <p className="mt-2 font-semibold text-xl">
              {data[key] === null ? t('dashboard.ai.noTiming') : t('dashboard.ai.milliseconds', { value: f.number(data[key]) })}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
