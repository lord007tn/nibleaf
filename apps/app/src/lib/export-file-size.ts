import type { Locale } from '@nibleaf/i18n/locales';
import { settings_exports_workflow_size_bytes } from '@nibleaf/i18n/messages/settings_exports_workflow_size_bytes';
import { settings_exports_workflow_size_gib } from '@nibleaf/i18n/messages/settings_exports_workflow_size_gib';
import { settings_exports_workflow_size_kib } from '@nibleaf/i18n/messages/settings_exports_workflow_size_kib';
import { settings_exports_workflow_size_mib } from '@nibleaf/i18n/messages/settings_exports_workflow_size_mib';
import { scopedTranslate } from '@nibleaf/i18n/scoped';
import { localeTag } from './format';

// The caller names the locale, so the size must not depend on which dashboard
// catalog happens to be loaded.
export const EXPORT_SIZE_MESSAGES = {
  'settings.exports.workflow.size.gib': settings_exports_workflow_size_gib,
  'settings.exports.workflow.size.mib': settings_exports_workflow_size_mib,
  'settings.exports.workflow.size.kib': settings_exports_workflow_size_kib,
  'settings.exports.workflow.size.bytes': settings_exports_workflow_size_bytes,
} as const;

const units = [
  { bytes: 1024 ** 3, key: 'settings.exports.workflow.size.gib' },
  { bytes: 1024 ** 2, key: 'settings.exports.workflow.size.mib' },
  { bytes: 1024, key: 'settings.exports.workflow.size.kib' },
  { bytes: 1, key: 'settings.exports.workflow.size.bytes' },
] as const satisfies readonly { bytes: number; key: keyof typeof EXPORT_SIZE_MESSAGES }[];

export function formatExportFileSize(bytes: number, locale: Locale): string {
  const unit = units.find((candidate) => bytes >= candidate.bytes) ?? units[3];
  const value = new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: unit.bytes === 1 ? 0 : 2 }).format(bytes / unit.bytes);
  return scopedTranslate(EXPORT_SIZE_MESSAGES, unit.key, { value }, locale);
}
