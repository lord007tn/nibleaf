import { ChartContainer, ChartTooltip, ChartTooltipContent } from '@nibleaf/design-system/components/ui/chart';
import { useT } from '@nibleaf/i18n/react';
import type { AiConversationSummary } from '@nibleaf/validators';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { ListCard } from '@/components/analytics/list-card';
import { useFormatters } from '@/lib/format';

/** AI spend is often a fraction of a cent; keep two significant digits there
 * instead of rounding a real cost to "$0.00". */
export const aiCost = (f: ReturnType<typeof useFormatters>, value: number) =>
  value > 0 && value < 0.01 ? f.number(value, { style: 'currency', currency: 'USD', maximumSignificantDigits: 2 }) : f.currency(value);

export function CostValue({ usage }: { usage: AiConversationSummary['usage'] }) {
  const t = useT();
  const f = useFormatters();
  return (
    <>
      {usage.costUsd === null
        ? t('dashboard.ai.unknownCost')
        : usage.costComplete
          ? aiCost(f, usage.costUsd)
          : t('dashboard.ai.atLeast', { cost: aiCost(f, usage.costUsd) })}
    </>
  );
}
export function Overview({ data }: { data: AiConversationSummary }) {
  const t = useT();
  const f = useFormatters();
  const totalRated = data.feedback.up + data.feedback.down;
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
      <div className="grid gap-4 lg:grid-cols-2">
        <Series data={data.timeseries} kind="questions" />
        <Series data={data.timeseries} kind="cost" />
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
function Series({ data, kind }: { data: AiConversationSummary['timeseries']; kind: 'questions' | 'cost' }) {
  const t = useT();
  const f = useFormatters();
  const unknown = kind === 'cost' && data.every((point) => point.costUsd === null);
  const title = t(kind === 'questions' ? 'dashboard.ai.overTime' : 'dashboard.ai.costOverTime');
  return (
    <section className="min-w-0 rounded-xl border bg-card p-5">
      <h2 className="mb-4 font-medium text-sm">{title}</h2>
      <ChartContainer
        className="h-60 w-full"
        dir="ltr"
        config={{
          answered: { label: t('dashboard.ai.answered'), color: 'var(--chart-1)' },
          noAnswer: { label: t('dashboard.ai.no_answer'), color: 'var(--chart-2)' },
          costUsd: { label: t('dashboard.ai.cost'), color: 'var(--chart-1)' },
        }}
      >
        <AreaChart accessibilityLayer data={data}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="date" tickFormatter={(value) => f.shortDate(value)} />
          <YAxis width={kind === 'cost' ? 64 : 50} tickFormatter={(value) => (kind === 'cost' ? aiCost(f, value) : f.number(value))} />
          <ChartTooltip content={<ChartTooltipContent />} />
          {kind === 'questions' ? (
            <>
              <Area dataKey="answered" stackId="questions" stroke="var(--chart-1)" fill="var(--chart-1)" />
              <Area dataKey="noAnswer" stackId="questions" stroke="var(--chart-2)" fill="var(--chart-2)" />
            </>
          ) : (
            <Area dataKey="costUsd" connectNulls={false} stroke="var(--chart-1)" fill="var(--chart-1)" />
          )}
        </AreaChart>
      </ChartContainer>
      {unknown && <p className="text-muted-foreground text-sm">{t('dashboard.ai.unknownCost')}</p>}
      {kind === 'cost' && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm">{t('dashboard.ai.details')}</summary>
          <h3 className="my-2 text-sm">{t('dashboard.ai.usageOverTime')}</h3>
          <ChartContainer
            className="h-48 w-full"
            dir="ltr"
            config={{
              inputTokens: { label: t('dashboard.ai.tokens'), color: 'var(--chart-1)' },
              outputTokens: { label: t('dashboard.ai.tokens'), color: 'var(--chart-2)' },
            }}
          >
            <AreaChart data={data}>
              <XAxis dataKey="date" tickFormatter={(value) => f.shortDate(value)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Area dataKey="inputTokens" stackId="usage" fill="var(--chart-1)" />
              <Area dataKey="outputTokens" stackId="usage" fill="var(--chart-2)" />
            </AreaChart>
          </ChartContainer>
        </details>
      )}
    </section>
  );
}
