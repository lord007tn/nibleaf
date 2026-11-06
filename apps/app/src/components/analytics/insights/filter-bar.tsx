import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useT } from '@nibleaf/i18n/react';
import { CalendarRange } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { RangeTabs } from '../range-tabs';
import { customRangeError, type InsightsSearch, localIsoDay } from './filters';
import { useInsightFormat } from './use-insight-format';

const CUSTOM_ERROR_KEYS = {
  missing: 'analytics.filter.custom.errorMissing',
  order: 'analytics.filter.custom.errorOrder',
  tooLong: 'analytics.filter.custom.errorTooLong',
} as const;

/** Two native date inputs in a popover: accessible, keyboard-friendly and localized by the browser. */
function CustomRangePicker({ filters, onApply }: { filters: InsightsSearch; onApply: (from: string, to: string) => void }) {
  const t = useT();
  const format = useInsightFormat();
  const id = useId();
  const today = localIsoDay(new Date());
  const monthAgo = localIsoDay(new Date(Date.now() - 29 * 86_400_000));
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(filters.from ?? monthAgo);
  const [to, setTo] = useState(filters.to ?? today);
  const [submitted, setSubmitted] = useState(false);
  const error = customRangeError(from, to);
  const active = filters.range === 'custom' && filters.from && filters.to;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (error) return;
    onApply(from, to);
    setOpen(false);
  };

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFrom(filters.from ?? monthAgo);
          setTo(filters.to ?? today);
          setSubmitted(false);
        }
      }}
      open={open}
    >
      <PopoverTrigger
        render={
          <Button aria-pressed={Boolean(active)} size="sm" variant={active ? 'secondary' : 'outline'}>
            <CalendarRange aria-hidden />
            {active
              ? t('analytics.filter.custom.active', { from: format.day(filters.from ?? ''), to: format.day(filters.to ?? '') })
              : t('analytics.filter.custom.label')}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-80">
        <form className="flex flex-col gap-3" noValidate onSubmit={submit}>
          <div>
            <PopoverTitle className="font-medium">{t('analytics.filter.custom.title')}</PopoverTitle>
            <PopoverDescription className="text-muted-foreground text-xs">{t('analytics.filter.custom.description')}</PopoverDescription>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-from`}>{t('analytics.filter.custom.from')}</Label>
              <Input
                aria-invalid={submitted && error !== null}
                id={`${id}-from`}
                max={to || today}
                onChange={(event) => setFrom(event.target.value)}
                type="date"
                value={from}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-to`}>{t('analytics.filter.custom.to')}</Label>
              <Input
                aria-invalid={submitted && error !== null}
                id={`${id}-to`}
                max={today}
                min={from || undefined}
                onChange={(event) => setTo(event.target.value)}
                type="date"
                value={to}
              />
            </div>
          </div>
          {submitted && error ? (
            <p className="text-destructive text-xs" role="alert">
              {t(CUSTOM_ERROR_KEYS[error])}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setOpen(false)} size="sm" type="button" variant="ghost">
              {t('common.cancel')}
            </Button>
            <Button size="sm" type="submit">
              {t('analytics.filter.custom.apply')}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

/** Range presets, a custom date range and the comparison toggle. Wraps on narrow screens. */
export function InsightsFilterBar({
  filters,
  onChange,
  timezone,
}: {
  filters: InsightsSearch;
  onChange: (next: InsightsSearch) => void;
  timezone: string;
}) {
  const t = useT();
  const compareId = useId();
  const compareOn = filters.compare !== 'none';
  const keepCompare = compareOn ? {} : ({ compare: 'none' } as const);
  const preset = filters.range === 'custom' ? null : (filters.range ?? '30d');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="max-w-full overflow-x-auto">
        <RangeTabs onValueChange={(range) => onChange({ range, ...keepCompare })} value={preset} />
      </div>
      <CustomRangePicker filters={filters} onApply={(from, to) => onChange({ range: 'custom', from, to, ...keepCompare })} />
      <div className="flex items-center gap-2">
        <Switch checked={compareOn} id={compareId} onCheckedChange={(checked) => onChange({ ...filters, compare: checked ? undefined : 'none' })} />
        <Label className="font-normal text-sm" htmlFor={compareId}>
          {t('analytics.filter.compare')}
        </Label>
      </div>
      <p className="text-muted-foreground text-xs">{t('analytics.filter.timezone', { timezone })}</p>
    </div>
  );
}
