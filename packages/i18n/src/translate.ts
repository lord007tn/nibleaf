import type { Locale } from './locales';
import { MESSAGE_IDS, type MessageKey } from './message-ids';
import type { MessageFn, MessageVariables } from './message-types';
// biome-ignore lint/suspicious/noTsIgnore: Paraglide generates runtime JavaScript without declaration files.
// @ts-ignore -- generated message functions are indexed through the stable dotted-key map.
import * as messages from './paraglide/messages.js';

export function translateFn(key: MessageKey, variables?: MessageVariables, locale?: Locale): string {
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: typed dotted keys map to Paraglide's generated identifiers.
  const message = messages[MESSAGE_IDS[key] as keyof typeof messages] as unknown as MessageFn | undefined;
  return message?.(variables, locale ? { locale } : undefined) ?? key;
}
