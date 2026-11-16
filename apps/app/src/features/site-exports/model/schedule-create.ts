/**
 * Creating an export schedule, as pure logic: what the creation form edits,
 * its defaults, how it is validated and the request body a valid draft sends.
 * Rendered by `components/schedule-create-form.tsx`; tested in
 * `schedule-create.test.ts`.
 *
 * `createExportScheduleBody` is the authority: the field checks below report
 * problems field by field, as the person types, and the body is still parsed
 * by the schema before it is sent. Creation always sends a complete body.
 */
import type { MessageKey } from '@nibleaf/i18n';
import { type CreateExportScheduleBody, createExportScheduleBody, type ExportFormatInput } from '@nibleaf/validators';

export type ScheduleCadence = CreateExportScheduleBody['cadence'];

/** Every format, in the order they are listed and the default selection. */
export const SCHEDULE_FORMATS: readonly ExportFormatInput[] = ['MARKDOWN', 'PDF', 'STATIC_HTML'];

export const EXPORT_FORMAT_LABELS: Record<ExportFormatInput, MessageKey> = {
  MARKDOWN: 'settings.exports.workflow.format.markdown',
  PDF: 'settings.exports.workflow.format.pdf',
  STATIC_HTML: 'settings.exports.workflow.format.html',
};

/** The schema's longest name (after trimming). The name input stops there. */
export const SCHEDULE_NAME_MAX = 80;

/** The schema's whole-number bounds for the numbers typed into the form. */
export const SCHEDULE_NUMBER_BOUNDS = {
  monthday: { min: 1, max: 31 },
  retentionCount: { min: 1, max: 100 },
  retentionDays: { min: 1, max: 3650 },
} as const;

export type ScheduleNumberField = keyof typeof SCHEDULE_NUMBER_BOUNDS;

/** Everything the creation form edits. Typed values stay as typed, so a blank or partial entry is kept and explained. */
export type ScheduleDraftValues = {
  name: string;
  timezone: string;
  cadence: ScheduleCadence;
  /** From the time input: "HH:MM", or empty while it is blank or incomplete. */
  time: string;
  /** 0 (Sunday) to 6; sent only for a weekly schedule. */
  weekday: number;
  /** As typed; sent only for a monthly schedule. */
  monthday: string;
  retentionCount: string;
  retentionDays: string;
  /** In the order they were chosen; never empty. */
  formats: ExportFormatInput[];
};

export type ScheduleField = keyof ScheduleDraftValues;

/** Each field's visible label, also used in its messages. */
export const SCHEDULE_FIELD_LABELS: Record<Exclude<ScheduleField, 'formats'>, MessageKey> = {
  name: 'settings.exports.workflow.scheduleName',
  timezone: 'settings.exports.workflow.timezone',
  cadence: 'settings.exports.workflow.schedules',
  time: 'settings.exports.workflow.localTime',
  weekday: 'settings.exports.workflow.weekday',
  monthday: 'settings.exports.workflow.monthDay',
  retentionCount: 'settings.exports.workflow.retainRuns',
  retentionDays: 'settings.exports.workflow.retentionDays',
};

/**
 * - `required`: blank, or a time that isn't complete;
 * - `range`: not a whole number within the field's bounds;
 * - `invalid`: refused by the schema although the field checks passed.
 */
export type ScheduleProblem = 'required' | 'range' | 'invalid';
export type ScheduleProblems = Partial<Record<ScheduleField, ScheduleProblem>>;

/** The browser's timezone, or UTC when it reports none. */
export const detectedTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/**
 * A new draft's values. Pass the localized default name and the detected
 * timezone once, when the draft opens: a later language change neither
 * renames the draft nor makes it look edited.
 */
export const scheduleDraftDefaults = ({ name, timezone }: { name: string; timezone: string }): ScheduleDraftValues => ({
  name,
  timezone,
  cadence: 'DAILY',
  time: '02:00',
  weekday: 1,
  monthday: '1',
  retentionCount: '12',
  retentionDays: '90',
  formats: [...SCHEDULE_FORMATS],
});

let supportedTimezones: readonly string[] | undefined;

/**
 * The timezones offered for a draft: UTC, the detected zone, then every IANA
 * zone the browser supports, each once. The supported list is read once.
 */
export function scheduleTimezones(detected: string): string[] {
  supportedTimezones ??= Intl.supportedValuesOf('timeZone');
  return [...new Set(['UTC', detected, ...supportedTimezones])];
}

/** "Africa/Porto_Novo" → "Africa/Porto Novo". The value itself is the IANA identifier. */
export const timezoneLabel = (timezone: string): string => timezone.replaceAll('_', ' ');

/** "HH:MM" (seconds, if a browser adds them, must be zero) → hour and minute; undefined when blank or incomplete. */
export function parseScheduleTime(time: string): { hour: number; minute: number } | undefined {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::00(?:\.0+)?)?$/.exec(time);
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : undefined;
}

/** A typed whole number within bounds; undefined otherwise. Blank is never zero. */
function parseWholeNumber(text: string, { min, max }: { min: number; max: number }): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

const validTimezone = (timezone: string) => {
  if (!timezone) return false;
  try {
    // The schema's own check: an identifier Intl can't format in is refused.
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
};

const numberProblem = (text: string, field: ScheduleNumberField): ScheduleProblem | undefined => {
  if (!text.trim()) return 'required';
  return parseWholeNumber(text, SCHEDULE_NUMBER_BOUNDS[field]) === undefined ? 'range' : undefined;
};

/** What is wrong with one field of a draft. A weekday or day of month the cadence doesn't use is never a problem. */
export function scheduleFieldProblem(field: ScheduleField, values: ScheduleDraftValues): ScheduleProblem | undefined {
  switch (field) {
    case 'name':
      return values.name.trim() ? undefined : 'required';
    case 'timezone':
      return validTimezone(values.timezone) ? undefined : 'required';
    case 'cadence':
      return ['DAILY', 'WEEKLY', 'MONTHLY'].includes(values.cadence) ? undefined : 'required';
    case 'time':
      return parseScheduleTime(values.time) ? undefined : 'required';
    case 'weekday':
      return values.cadence !== 'WEEKLY' || (Number.isInteger(values.weekday) && values.weekday >= 0 && values.weekday <= 6) ? undefined : 'required';
    case 'monthday':
      return values.cadence === 'MONTHLY' ? numberProblem(values.monthday, 'monthday') : undefined;
    case 'formats':
      return values.formats.length > 0 && values.formats.every((format) => SCHEDULE_FORMATS.includes(format)) ? undefined : 'required';
    default:
      return numberProblem(values[field], field);
  }
}

const FIELDS: readonly ScheduleField[] = ['name', 'timezone', 'cadence', 'time', 'weekday', 'monthday', 'retentionCount', 'retentionDays', 'formats'];

export function scheduleProblems(values: ScheduleDraftValues): ScheduleProblems {
  const problems: ScheduleProblems = {};
  for (const field of FIELDS) {
    const problem = scheduleFieldProblem(field, values);
    if (problem) problems[field] = problem;
  }
  return problems;
}

/** Which form field a schema issue belongs to. */
const fieldOfIssue = (path: ReadonlyArray<PropertyKey>): ScheduleField => {
  const key = String(path[0]);
  if (key === 'hour' || key === 'minute') return 'time';
  return (FIELDS as readonly string[]).includes(key) ? (key as ScheduleField) : 'name';
};

/**
 * The complete body for a new schedule, or the problems that stop it. Only the
 * cadence's own day is sent (weekday for weekly, day of month for monthly).
 */
export function toCreateScheduleBody(
  values: ScheduleDraftValues,
): { ok: true; body: CreateExportScheduleBody } | { ok: false; problems: ScheduleProblems } {
  const problems = scheduleProblems(values);
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  const time = parseScheduleTime(values.time);
  const retentionCount = parseWholeNumber(values.retentionCount, SCHEDULE_NUMBER_BOUNDS.retentionCount);
  const retentionDays = parseWholeNumber(values.retentionDays, SCHEDULE_NUMBER_BOUNDS.retentionDays);
  const monthday = parseWholeNumber(values.monthday, SCHEDULE_NUMBER_BOUNDS.monthday);
  if (!time || retentionCount === undefined || retentionDays === undefined) return { ok: false, problems: { time: 'invalid' } };
  const body = {
    name: values.name.trim(),
    formats: [...values.formats],
    cadence: values.cadence,
    timezone: values.timezone,
    hour: time.hour,
    minute: time.minute,
    ...(values.cadence === 'WEEKLY' ? { weekday: values.weekday } : {}),
    ...(values.cadence === 'MONTHLY' ? { monthday } : {}),
    retentionCount,
    retentionDays,
  };
  const parsed = createExportScheduleBody.safeParse(body);
  if (!parsed.success) {
    return { ok: false, problems: Object.fromEntries(parsed.error.issues.map((issue) => [fieldOfIssue(issue.path), 'invalid'])) };
  }
  return { ok: true, body };
}
