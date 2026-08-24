import { createHash } from 'node:crypto';
import { z } from 'zod';

export const USAGE_EVENT_VERSION = 1 as const;

export const meterKeys = [
  'public_page_view',
  'search_query',
  'ai_answer',
  'ai_input_token',
  'ai_output_token',
  'embedded_chunk',
  'indexed_content_byte',
  'build',
] as const;

export const meterKeySchema = z.enum(meterKeys);
export type MeterKey = z.infer<typeof meterKeySchema>;

export const INT64_MIN = -(2n ** 63n);
export const INT64_MAX = 2n ** 63n - 1n;
export const DECIMAL38_MAX = 10n ** 38n - 1n;
export const DECIMAL38_MIN = -DECIMAL38_MAX;

const canonicalSignedDecimalSchema = z
  .string()
  .regex(/^-?(?:0|[1-9]\d*)$/u)
  .refine((value) => value !== '-0', 'Negative zero is not canonical');

export const signedDecimalSchema = canonicalSignedDecimalSchema.refine((value) => {
  const quantity = BigInt(value);
  return quantity >= INT64_MIN && quantity <= INT64_MAX;
}, 'Quantity must fit a signed Int64');

/** Exact aggregate boundary shared by ClickHouse rollups, Postgres export
 * checkpoints, and future provider adapters. Individual facts remain Int64. */
export const aggregateDecimalSchema = canonicalSignedDecimalSchema.refine((value) => {
  const quantity = BigInt(value);
  return quantity >= DECIMAL38_MIN && quantity <= DECIMAL38_MAX;
}, 'Aggregate quantity must fit Decimal(38,0)');

export const capabilityKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
export const planKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);

export const usageEventSchema = z
  .object({
    eventId: z.uuid(),
    schemaVersion: z.literal(USAGE_EVENT_VERSION),
    occurredAt: z.iso.datetime({ offset: true }),
    receivedAt: z.iso.datetime({ offset: true }),
    tenantId: z.string().trim().min(1).max(128),
    projectId: z.string().trim().min(1).max(128),
    meterKey: meterKeySchema,
    quantity: signedDecimalSchema,
    kind: z.enum(['usage', 'correction']).default('usage'),
    correctionOfEventId: z.uuid().nullable().default(null),
    source: z.enum(['api', 'backfill', 'dashboard', 'public_site', 'system', 'worker']),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.kind === 'usage' && event.quantity.startsWith('-')) {
      context.addIssue({ code: 'custom', message: 'Usage quantities cannot be negative', path: ['quantity'] });
    }
    if (event.kind === 'usage' && event.correctionOfEventId) {
      context.addIssue({ code: 'custom', message: 'Usage events cannot reference a correction target', path: ['correctionOfEventId'] });
    }
    if (event.kind === 'correction' && !event.correctionOfEventId) {
      context.addIssue({ code: 'custom', message: 'Corrections require an original event id', path: ['correctionOfEventId'] });
    }
  });

export type UsageEvent = z.infer<typeof usageEventSchema>;

export const usageEventBatchSchema = z
  .array(usageEventSchema)
  .min(1)
  .max(1000)
  .superRefine((events, context) => {
    const first = events[0];
    if (!first) return;
    if (events.some((event) => event.tenantId !== first.tenantId || event.projectId !== first.projectId)) {
      context.addIssue({ code: 'custom', message: 'A usage batch must belong to one tenant and project' });
    }
    if (new Set(events.map((event) => event.eventId)).size !== events.length) {
      context.addIssue({ code: 'custom', message: 'A usage batch cannot repeat an event id' });
    }
  });

export type UsageEventBatch = z.infer<typeof usageEventBatchSchema>;

export const canonicalUsageEventBatch = (events: UsageEvent[]) =>
  usageEventBatchSchema.parse(events).toSorted((left, right) => left.eventId.localeCompare(right.eventId));

export interface UsageEventContext {
  tenantId: string;
  projectId: string;
  source: UsageEvent['source'];
  receivedAt?: Date;
}

const USAGE_UUID_NAMESPACE = '7ae7b3d1-972e-5e50-a173-8d9d84f62b9f';

/** RFC 9562 UUIDv8 with a fixed Nibleaf namespace and an application-defined
 * SHA-256 layout. Stable retries share an id; explicit separators keep
 * unrelated source contracts in distinct collision domains. */
export const deterministicUsageEventId = (scope: string, domain = 'usage-event-v1'): string => {
  const namespace = Buffer.from(USAGE_UUID_NAMESPACE.replaceAll('-', ''), 'hex');
  const bytes = createHash('sha256').update(namespace).update('\0').update(domain).update('\0').update(scope).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const buildUsageEvent = (
  input: Omit<UsageEvent, 'schemaVersion' | 'tenantId' | 'projectId' | 'receivedAt' | 'source'>,
  context: UsageEventContext,
) =>
  usageEventSchema.parse({
    ...input,
    schemaVersion: USAGE_EVENT_VERSION,
    tenantId: context.tenantId,
    projectId: context.projectId,
    receivedAt: (context.receivedAt ?? new Date()).toISOString(),
    source: context.source,
  });

export const utcBillingPeriod = (occurredAt: string) => {
  const date = new Date(occurredAt);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), endExclusive: end.toISOString() };
};

export const isLateUsageEvent = (event: UsageEvent, now = new Date()) => {
  const eventPeriod = utcBillingPeriod(event.occurredAt);
  const currentPeriod = utcBillingPeriod(now.toISOString());
  return eventPeriod.endExclusive <= currentPeriod.start;
};
