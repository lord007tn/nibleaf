import { Button } from '@nibleaf/design-system/components/ui/button';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { CalendarRange } from 'lucide-react';
import { useId, useState } from 'react';
import { RangeTabs } from '../range-tabs';
import { customRangeError, type InsightsSearch, localIsoDay } from './filters';
import { useInsightFormat } from './use-insight-format';

/** Today and 29 days earlier, as local calendar days: the suggested 30-day custom range. */
const defaultDays = () => ({ today: localIsoDay(new Date()), monthAgo: localIsoDay(new Date(Date.now() - 29 * 86_400_000)) });

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
  const errorId = `${id}-error`;
  // Read the clock once per picker, not on every render.
  const [{ today, monthAgo }] = useState(defaultDays);
  const [open, setOpen] = useState(false);
  const active = filters.range === 'custom' && filters.from && filters.to;
  const validate = ({ value }: { value: { from: string; to: string } }) => {
    const error = customRangeError(value.from, value.to);
    return error ? t(CUSTOM_ERROR_KEYS[error]) : undefined;
  };
  const form = useForm({
    defaultValues: { from: filters.from ?? monthAgo, to: filters.to ?? today },
    // Checked on every change so a corrected date clears the message at once;
    // shown only after the first Apply, so typing a date never starts with an error.
    validators: { onChange: validate, onSubmit: validate },
    onSubmit: ({ value }) => {
      onApply(value.from, value.to);
      setOpen(false);
    },
  });

  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset({ from: filters.from ?? monthAgo, to: filters.to ?? today });
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
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div>
            <PopoverTitle className="font-medium">{t('analytics.filter.custom.title')}</PopoverTitle>
            <PopoverDescription className="text-muted-foreground text-xs">{t('analytics.filter.custom.description')}</PopoverDescription>
          </div>
          <form.Subscribe selector={(state) => ({ errors: state.submissionAttempts > 0 ? state.errors : [], from: state.values.from })}>
            {({ errors, from }) => {
              const invalid = errors.length > 0;
              return (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <form.Field name="from">
                      {(field) => (
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <Label htmlFor={`${id}-from`}>{t('analytics.filter.custom.from')}</Label>
                          <Input
                            aria-describedby={invalid ? errorId : undefined}
                            aria-invalid={invalid}
                            id={`${id}-from`}
                            max={today}
                            name={field.name}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            type="date"
                            value={field.state.value}
                          />
                        </div>
                      )}
                    </form.Field>
                    <form.Field name="to">
                      {(field) => (
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <Label htmlFor={`${id}-to`}>{t('analytics.filter.custom.to')}</Label>
                          <Input
                            aria-describedby={invalid ? errorId : undefined}
                            aria-invalid={invalid}
                            id={`${id}-to`}
                            max={today}
                            min={from || undefined}
                            name={field.name}
                            onBlur={field.handleBlur}
                            onChange={(event) => field.handleChange(event.target.value)}
                            type="date"
                            value={field.state.value}
                          />
                        </div>
                      )}
                    </form.Field>
                  </div>
                  <FieldError errors={errors} id={errorId} role="alert" />
                </>
              );
            }}
          </form.Subscribe>
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
