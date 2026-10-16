import { type Locale, type MessageKey, translateFn } from '@nibleaf/i18n';
import { localeTag } from './format';

const units = [
  { bytes: 1024 ** 3, key: 'settings.exports.workflow.size.gib' },
  { bytes: 1024 ** 2, key: 'settings.exports.workflow.size.mib' },
  { bytes: 1024, key: 'settings.exports.workflow.size.kib' },
  { bytes: 1, key: 'settings.exports.workflow.size.bytes' },
] as const satisfies readonly { bytes: number; key: MessageKey }[];

export function formatExportFileSize(bytes: number, locale: Locale): string {
  const unit = units.find((candidate) => bytes >= candidate.bytes) ?? units[3];
  const value = new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: unit.bytes === 1 ? 0 : 2 }).format(bytes / unit.bytes);
  return translateFn(unit.key, { value }, locale);
}
