import { createExportScheduleBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import {
  parseScheduleTime,
  SCHEDULE_NUMBER_BOUNDS,
  type ScheduleDraftValues,
  scheduleDraftDefaults,
  scheduleFieldProblem,
  scheduleProblems,
  scheduleTimezones,
  timezoneLabel,
  toCreateScheduleBody,
} from './schedule-create';

const defaults = () => scheduleDraftDefaults({ name: 'Nightly archive', timezone: 'Africa/Lagos' });
const draft = (patch: Partial<ScheduleDraftValues> = {}): ScheduleDraftValues => ({ ...defaults(), ...patch });
const body = (patch: Partial<ScheduleDraftValues> = {}) => {
  const result = toCreateScheduleBody(draft(patch));
  if (!result.ok) throw new Error(`expected a body, got ${JSON.stringify(result.problems)}`);
  return result.body;
};

describe('a new schedule draft', () => {
  it('starts from the documented defaults with the name and timezone it was given', () => {
    expect(defaults()).toEqual({
      name: 'Nightly archive',
      timezone: 'Africa/Lagos',
      cadence: 'DAILY',
      time: '02:00',
      weekday: 1,
      monthday: '1',
      retentionCount: '12',
      retentionDays: '90',
      formats: ['MARKDOWN', 'PDF', 'STATIC_HTML'],
    });
    expect(scheduleProblems(defaults())).toEqual({});
  });

  it('sends the complete default body, which the schema accepts unchanged', () => {
    const sent = body();
    expect(sent).toEqual({
      name: 'Nightly archive',
      formats: ['MARKDOWN', 'PDF', 'STATIC_HTML'],
      cadence: 'DAILY',
      timezone: 'Africa/Lagos',
      hour: 2,
      minute: 0,
      retentionCount: 12,
      retentionDays: 90,
    });
    expect(createExportScheduleBody.parse(sent)).toEqual(sent);
  });

  it('gives each draft its own formats list', () => {
    const first = defaults();
    first.formats.pop();
    expect(defaults().formats).toEqual(['MARKDOWN', 'PDF', 'STATIC_HTML']);
  });
});

describe('cadence and its day', () => {
  it('sends neither day for a daily schedule, whatever the hidden fields hold', () => {
    const sent = body({ cadence: 'DAILY', weekday: 9, monthday: '' });
    expect(sent).not.toHaveProperty('weekday');
    expect(sent).not.toHaveProperty('monthday');
  });

  it('sends only the weekday for a weekly schedule, and requires a real one', () => {
    const sent = body({ cadence: 'WEEKLY', weekday: 0, monthday: 'not used' });
    expect(sent).toMatchObject({ cadence: 'WEEKLY', weekday: 0 });
    expect(sent).not.toHaveProperty('monthday');
    expect(body({ cadence: 'WEEKLY', weekday: 6 }).weekday).toBe(6);
    expect(scheduleFieldProblem('weekday', draft({ cadence: 'WEEKLY', weekday: 7 }))).toBe('required');
    expect(scheduleFieldProblem('weekday', draft({ cadence: 'WEEKLY', weekday: 1.5 }))).toBe('required');
  });

  it('sends only the day of month for a monthly schedule, and requires it in 1-31', () => {
    const sent = body({ cadence: 'MONTHLY', monthday: '31', weekday: 99 });
    expect(sent).toMatchObject({ cadence: 'MONTHLY', monthday: 31 });
    expect(sent).not.toHaveProperty('weekday');
    expect(scheduleFieldProblem('monthday', draft({ cadence: 'MONTHLY', monthday: '' }))).toBe('required');
    expect(scheduleFieldProblem('monthday', draft({ cadence: 'MONTHLY', monthday: '0' }))).toBe('range');
    expect(scheduleFieldProblem('monthday', draft({ cadence: 'MONTHLY', monthday: '32' }))).toBe('range');
  });

  it("never reports a problem in a day the cadence doesn't use", () => {
    expect(scheduleFieldProblem('monthday', draft({ cadence: 'WEEKLY', monthday: '' }))).toBeUndefined();
    expect(scheduleFieldProblem('weekday', draft({ cadence: 'MONTHLY', weekday: -1 }))).toBeUndefined();
  });
});

describe('the run time', () => {
  it.each([
    ['00:00', { hour: 0, minute: 0 }],
    ['02:00', { hour: 2, minute: 0 }],
    ['23:59', { hour: 23, minute: 59 }],
    ['07:05:00', { hour: 7, minute: 5 }],
  ])('reads %s', (time, expected) => {
    expect(parseScheduleTime(time)).toEqual(expected);
    expect(body({ time })).toMatchObject(expected);
  });

  it.each(['', '2:00', '24:00', '12:60', '12:3', '07:05:30', 'noon'])('refuses %j instead of falling back to 02:00', (time) => {
    expect(parseScheduleTime(time)).toBeUndefined();
    expect(toCreateScheduleBody(draft({ time }))).toEqual({ ok: false, problems: { time: 'required' } });
  });
});

describe('typed numbers', () => {
  it.each(Object.entries(SCHEDULE_NUMBER_BOUNDS))('takes %s within its bounds and nothing outside them', (field, { min, max }) => {
    const patch = (value: string) => ({ cadence: 'MONTHLY' as const, [field]: value });
    expect(scheduleFieldProblem(field as keyof ScheduleDraftValues, draft(patch(String(min))))).toBeUndefined();
    expect(scheduleFieldProblem(field as keyof ScheduleDraftValues, draft(patch(String(max))))).toBeUndefined();
    expect(scheduleFieldProblem(field as keyof ScheduleDraftValues, draft(patch(String(min - 1))))).toBe('range');
    expect(scheduleFieldProblem(field as keyof ScheduleDraftValues, draft(patch(String(max + 1))))).toBe('range');
  });

  it('keeps blank as a problem, never zero', () => {
    const result = toCreateScheduleBody(draft({ retentionCount: '', retentionDays: '  ' }));
    expect(result).toEqual({ ok: false, problems: { retentionCount: 'required', retentionDays: 'required' } });
  });

  it.each(['1.5', '-3', 'abc', 'Infinity', '1e400', 'NaN'])('refuses %j, so no NaN or Infinity can reach the request', (value) => {
    expect(scheduleFieldProblem('retentionCount', draft({ retentionCount: value }))).toBe('range');
  });

  it('reads whole numbers the number input can produce', () => {
    expect(body({ retentionCount: ' 30 ', retentionDays: '1e2' })).toMatchObject({ retentionCount: 30, retentionDays: 100 });
  });
});

describe('name, timezone and formats', () => {
  it('requires a name and sends it trimmed, as the schema stores it', () => {
    expect(scheduleFieldProblem('name', draft({ name: '   ' }))).toBe('required');
    expect(body({ name: '  أرشيف ليلي  ' }).name).toBe('أرشيف ليلي');
  });

  it('accepts the IANA timezones the schema accepts, unchanged', () => {
    for (const timezone of ['UTC', 'Asia/Kolkata', 'America/Argentina/Buenos_Aires']) {
      expect(body({ timezone }).timezone).toBe(timezone);
    }
    for (const timezone of ['', 'UTC+1', 'Mars/Olympus']) {
      expect(scheduleFieldProblem('timezone', draft({ timezone }))).toBe('required');
      expect(createExportScheduleBody.safeParse({ ...body(), timezone }).success).toBe(false);
    }
  });

  it('offers UTC, the detected zone and the supported zones, each once', () => {
    const zones = scheduleTimezones('Africa/Lagos');
    expect(zones.slice(0, 2)).toEqual(['UTC', 'Africa/Lagos']);
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones).toContain('Asia/Tokyo');
    // A detected zone the browser doesn't list (an alias) is still offered.
    expect(scheduleTimezones('Asia/Calcutta')).toContain('Asia/Calcutta');
    expect(timezoneLabel('America/Port_of_Spain')).toBe('America/Port of Spain');
  });

  it('sends the chosen formats in their order, and needs at least one', () => {
    expect(body({ formats: ['STATIC_HTML', 'MARKDOWN'] }).formats).toEqual(['STATIC_HTML', 'MARKDOWN']);
    expect(scheduleFieldProblem('formats', draft({ formats: [] }))).toBe('required');
  });
});

describe('agreement with the schema', () => {
  // Every boundary the form checks, judged by both: the form never accepts what the server refuses, nor the reverse.
  const cases: Array<Partial<ScheduleDraftValues>> = [
    {},
    { cadence: 'WEEKLY', weekday: 0 },
    { cadence: 'WEEKLY', weekday: 6 },
    { cadence: 'MONTHLY', monthday: '1' },
    { cadence: 'MONTHLY', monthday: '31' },
    { cadence: 'MONTHLY', monthday: '32' },
    { retentionCount: '0' },
    { retentionCount: '100' },
    { retentionCount: '101' },
    { retentionDays: '3650' },
    { retentionDays: '3651' },
    { time: '23:59' },
    { name: 'x'.repeat(80) },
    { name: ` ${'x'.repeat(80)} ` },
    { name: 'x'.repeat(81) },
    { timezone: 'Etc/GMT+5' },
    { formats: ['PDF'] },
  ];

  it.each(cases)('agrees on %j', (patch) => {
    const values = draft(patch);
    const result = toCreateScheduleBody(values);
    const hour = Number(values.time.slice(0, 2));
    const minute = Number(values.time.slice(3, 5));
    const candidate = {
      name: values.name,
      formats: values.formats,
      cadence: values.cadence,
      timezone: values.timezone,
      hour,
      minute,
      ...(values.cadence === 'WEEKLY' ? { weekday: values.weekday } : {}),
      ...(values.cadence === 'MONTHLY' ? { monthday: Number(values.monthday) } : {}),
      retentionCount: Number(values.retentionCount),
      retentionDays: Number(values.retentionDays),
    };
    expect(result.ok).toBe(createExportScheduleBody.safeParse(candidate).success);
  });

  it('maps a refusal only the schema catches to its field', () => {
    expect(toCreateScheduleBody(draft({ name: 'x'.repeat(81) }))).toEqual({ ok: false, problems: { name: 'invalid' } });
  });
});
