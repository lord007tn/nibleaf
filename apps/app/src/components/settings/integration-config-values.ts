import type { MessageKey } from '@nibleaf/i18n';
import type { IntegrationPublicConfig } from '@nibleaf/shared/integrations';

type SearchRuntime = Extract<IntegrationPublicConfig, { providerId: 'qdrant' }>['searchRuntime'];
type ClickHouseMode = Extract<IntegrationPublicConfig, { providerId: 'clickhouse' }>['mode'];

export const SEARCH_RUNTIME_MESSAGE_KEYS = {
  legacy: 'settings.integrations.value.runtime.legacy',
  shadow: 'settings.integrations.value.runtime.shadow',
  hybrid: 'settings.integrations.value.runtime.hybrid',
} as const satisfies Record<SearchRuntime, MessageKey>;

export const CLICKHOUSE_MODE_MESSAGE_KEYS = {
  disabled: 'settings.integrations.value.mode.disabled',
  dual_write: 'settings.integrations.value.mode.dualWrite',
  shadow_read: 'settings.integrations.value.mode.shadowRead',
  clickhouse: 'settings.integrations.value.mode.clickhouse',
} as const satisfies Record<ClickHouseMode, MessageKey>;
