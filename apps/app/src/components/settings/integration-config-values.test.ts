import { translateFn } from '@nibleaf/i18n/react';
import { describe, expect, it } from 'vitest';
import { CLICKHOUSE_MODE_MESSAGE_KEYS, SEARCH_RUNTIME_MESSAGE_KEYS } from './integration-config-values';

describe('integration configuration enum labels', () => {
  it('maps every persisted runtime and analytics mode to localized copy', () => {
    expect(Object.keys(SEARCH_RUNTIME_MESSAGE_KEYS)).toEqual(['legacy', 'shadow', 'hybrid']);
    expect(Object.keys(CLICKHOUSE_MODE_MESSAGE_KEYS)).toEqual(['disabled', 'dual_write', 'shadow_read', 'clickhouse']);

    for (const [raw, key] of [...Object.entries(SEARCH_RUNTIME_MESSAGE_KEYS), ...Object.entries(CLICKHOUSE_MODE_MESSAGE_KEYS)]) {
      expect(translateFn(key, undefined, 'ar')).not.toBe(raw);
      expect(translateFn(key, undefined, 'ar')).not.toContain('_');
    }
  });
});
