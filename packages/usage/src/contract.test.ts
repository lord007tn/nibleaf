import { describe, expect, it } from 'vitest';
import {
  aggregateDecimalSchema,
  buildUsageEvent,
  DECIMAL38_MAX,
  DECIMAL38_MIN,
  deterministicUsageEventId,
  INT64_MAX,
  INT64_MIN,
  isLateUsageEvent,
  syncFinalizedUsage,
  utcBillingPeriod,
} from './index';

describe('usage event contract', () => {
  const context = { tenantId: 'tenant-server', projectId: 'project-server', source: 'worker' as const, receivedAt: new Date('2026-03-01T00:00:02Z') };

  it('derives tenant identity and stable retry ids', () => {
    const id = deterministicUsageEventId('publish:deployment-1');
    const event = buildUsageEvent(
      { eventId: id, occurredAt: '2026-02-28T23:59:59Z', meterKey: 'build', quantity: '1', kind: 'usage', correctionOfEventId: null },
      context,
    );
    expect(event.tenantId).toBe('tenant-server');
    expect(id).toBe('1556c8fc-a234-8d55-9623-822270572dc5');
    expect(event.eventId).toBe(deterministicUsageEventId('publish:deployment-1'));
    expect(event.eventId[14]).toBe('8');
    expect(event.eventId[19]).toMatch(/[89ab]/u);
    expect(deterministicUsageEventId('same', 'analytics')).not.toBe(deterministicUsageEventId('same', 'search-index'));
    expect(deterministicUsageEventId('b:c', 'a')).not.toBe(deterministicUsageEventId('c', 'a:b'));
  });

  it('uses UTC half-open month boundaries and identifies late arrivals', () => {
    expect(utcBillingPeriod('2026-02-28T23:59:59-08:00')).toEqual({ start: '2026-03-01T00:00:00.000Z', endExclusive: '2026-04-01T00:00:00.000Z' });
    const event = buildUsageEvent(
      {
        eventId: deterministicUsageEventId('late'),
        occurredAt: '2026-01-31T23:59:59Z',
        meterKey: 'search_query',
        quantity: '1',
        kind: 'usage',
        correctionOfEventId: null,
      },
      context,
    );
    expect(isLateUsageEvent(event, new Date('2026-03-01T00:00:00Z'))).toBe(true);
  });

  it('requires explicit signed corrections', () => {
    expect(() =>
      buildUsageEvent(
        {
          eventId: deterministicUsageEventId('negative'),
          occurredAt: '2026-02-01T00:00:00Z',
          meterKey: 'build',
          quantity: '-1',
          kind: 'usage',
          correctionOfEventId: null,
        },
        context,
      ),
    ).toThrow();
    expect(
      buildUsageEvent(
        {
          eventId: deterministicUsageEventId('correction'),
          occurredAt: '2026-02-01T00:00:00Z',
          meterKey: 'build',
          quantity: '-1',
          kind: 'correction',
          correctionOfEventId: deterministicUsageEventId('original'),
        },
        context,
      ).quantity,
    ).toBe('-1');
  });

  it('accepts canonical Int64 extrema and rejects overflow', () => {
    const event = (quantity: string) =>
      buildUsageEvent(
        {
          eventId: deterministicUsageEventId(`quantity:${quantity}`),
          occurredAt: '2026-02-01T00:00:00Z',
          meterKey: 'build',
          quantity,
          kind: quantity.startsWith('-') ? 'correction' : 'usage',
          correctionOfEventId: quantity.startsWith('-') ? deterministicUsageEventId('original') : null,
        },
        context,
      );
    expect(event(INT64_MAX.toString()).quantity).toBe(INT64_MAX.toString());
    expect(event(INT64_MIN.toString()).quantity).toBe(INT64_MIN.toString());
    expect(() => event((INT64_MAX + 1n).toString())).toThrow(/Int64/u);
    expect(() => event((INT64_MIN - 1n).toString())).toThrow(/Int64/u);
  });

  it('keeps aggregate quantities exact across the Decimal(38,0) domain', () => {
    expect(aggregateDecimalSchema.parse((INT64_MAX + 1n).toString())).toBe('9223372036854775808');
    expect(aggregateDecimalSchema.parse(DECIMAL38_MAX.toString())).toBe(DECIMAL38_MAX.toString());
    expect(aggregateDecimalSchema.parse(DECIMAL38_MIN.toString())).toBe(DECIMAL38_MIN.toString());
    expect(() => aggregateDecimalSchema.parse((DECIMAL38_MAX + 1n).toString())).toThrow(/Decimal\(38,0\)/u);
    expect(() => aggregateDecimalSchema.parse((DECIMAL38_MIN - 1n).toString())).toThrow(/Decimal\(38,0\)/u);
  });

  it('defers provider outages without rejecting canonical usage', async () => {
    const states: string[] = [];
    const records = [
      {
        tenantId: 'tenant',
        meterKey: 'build' as const,
        periodStart: '2026-02-01T00:00:00Z',
        periodEndExclusive: '2026-03-01T00:00:00Z',
        quantity: '2',
        reconciliationId: 'recon-1',
      },
    ];
    const result = await syncFinalizedUsage(
      {
        name: 'offline',
        reportUsage: async () => {
          throw new Error('provider down');
        },
      },
      records,
      {
        markAttempt: async () => {
          states.push('attempt');
        },
        markAccepted: async () => {
          states.push('accepted');
        },
        markFailed: async () => {
          states.push('failed');
        },
      },
    );
    expect(result.status).toBe('deferred');
    expect(JSON.stringify(result)).not.toContain('provider down');
    expect(states).toEqual(['attempt', 'failed']);
  });

  it('rejects acknowledgements outside the submitted reconciliation set', async () => {
    const failed: string[] = [];
    const records = [
      {
        tenantId: 'tenant',
        meterKey: 'build' as const,
        periodStart: '2026-02-01T00:00:00Z',
        periodEndExclusive: '2026-03-01T00:00:00Z',
        quantity: '2',
        reconciliationId: 'recon-1',
      },
    ];
    const result = await syncFinalizedUsage({ name: 'invalid', reportUsage: async () => ({ accepted: ['foreign-id'] }) }, records, {
      markAttempt: async () => undefined,
      markAccepted: async () => undefined,
      markFailed: async (id) => {
        failed.push(id);
      },
    });
    expect(result).toMatchObject({ status: 'deferred', error: 'provider_contract_failure' });
    expect(failed).toEqual(['recon-1']);
  });

  it('accepts only the acknowledged subset and defers the remainder', async () => {
    const accepted: string[] = [];
    const failed: string[] = [];
    const records = ['recon-1', 'recon-2'].map((reconciliationId) => ({
      tenantId: 'tenant',
      meterKey: 'build' as const,
      periodStart: '2026-02-01T00:00:00Z',
      periodEndExclusive: '2026-03-01T00:00:00Z',
      quantity: '2',
      reconciliationId,
    }));
    const result = await syncFinalizedUsage({ name: 'partial', reportUsage: async () => ({ accepted: ['recon-1'] }) }, records, {
      markAttempt: async () => undefined,
      markAccepted: async (id) => {
        accepted.push(id);
      },
      markFailed: async (id) => {
        failed.push(id);
      },
    });
    expect(result).toMatchObject({ status: 'deferred', accepted: ['recon-1'], deferred: ['recon-2'] });
    expect(accepted).toEqual(['recon-1']);
    expect(failed).toEqual(['recon-2']);
  });
});
