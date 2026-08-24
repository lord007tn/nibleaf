import type { MeterKey } from './contract';
import { aggregateDecimalSchema } from './contract';

export interface FinalizedUsageRecord {
  tenantId: string;
  meterKey: MeterKey;
  periodStart: string;
  periodEndExclusive: string;
  quantity: string;
  reconciliationId: string;
}

/** Billing providers receive finalized aggregates only. Product authorization,
 * quota decisions, event ingestion, and payment lifecycle state stay outside. */
export interface UsageBillingProvider {
  readonly name: string;
  reportUsage(records: FinalizedUsageRecord[]): Promise<{ accepted: string[] }>;
}

export interface UsageSyncCheckpointStore {
  markAttempt(record: FinalizedUsageRecord): Promise<void>;
  markAccepted(reconciliationId: string): Promise<void>;
  markFailed(reconciliationId: string): Promise<void>;
}

export const syncFinalizedUsage = async (provider: UsageBillingProvider, records: FinalizedUsageRecord[], checkpoints: UsageSyncCheckpointStore) => {
  if (records.some((record) => !aggregateDecimalSchema.safeParse(record.quantity).success)) {
    for (const record of records) await checkpoints.markFailed(record.reconciliationId);
    return {
      status: 'deferred' as const,
      accepted: [],
      deferred: records.map((record) => record.reconciliationId),
      error: 'quantity_out_of_range' as const,
    };
  }
  for (const record of records) await checkpoints.markAttempt(record);
  try {
    const result = await provider.reportUsage(records);
    const submitted = new Set(records.map((record) => record.reconciliationId));
    if (new Set(result.accepted).size !== result.accepted.length || result.accepted.some((id) => !submitted.has(id))) {
      for (const record of records) await checkpoints.markFailed(record.reconciliationId);
      return {
        status: 'deferred' as const,
        accepted: [],
        deferred: records.map((record) => record.reconciliationId),
        error: 'provider_contract_failure' as const,
      };
    }
    for (const id of result.accepted) await checkpoints.markAccepted(id);
    const accepted = new Set(result.accepted);
    const deferred = records.filter((record) => !accepted.has(record.reconciliationId)).map((record) => record.reconciliationId);
    for (const id of deferred) await checkpoints.markFailed(id);
    return deferred.length > 0
      ? { status: 'deferred' as const, accepted: result.accepted, deferred, error: 'provider_partial_acknowledgement' as const }
      : { status: 'accepted' as const, accepted: result.accepted, deferred: [] };
  } catch {
    for (const record of records) await checkpoints.markFailed(record.reconciliationId);
    return { status: 'deferred' as const, accepted: [], deferred: records.map((record) => record.reconciliationId) };
  }
};

/** Documentation-only mapping. This creates no Polar customer, product,
 * subscription, checkout, benefit, meter, or event. */
export const polarMeterMapping: Record<MeterKey, { externalKey: string; aggregation: 'sum' }> = {
  public_page_view: { externalKey: 'nibleaf_public_page_view', aggregation: 'sum' },
  search_query: { externalKey: 'nibleaf_search_query', aggregation: 'sum' },
  ai_answer: { externalKey: 'nibleaf_ai_answer', aggregation: 'sum' },
  ai_input_token: { externalKey: 'nibleaf_ai_input_token', aggregation: 'sum' },
  ai_output_token: { externalKey: 'nibleaf_ai_output_token', aggregation: 'sum' },
  embedded_chunk: { externalKey: 'nibleaf_embedded_chunk', aggregation: 'sum' },
  indexed_content_byte: { externalKey: 'nibleaf_indexed_content_byte', aggregation: 'sum' },
  build: { externalKey: 'nibleaf_build', aggregation: 'sum' },
};
