import { useT } from '@nibleaf/i18n/react';
import type { Decision } from '../model/permissions';

/** Turns a model Decision into the `disabledReason` a control takes: undefined when allowed. */
export function useReason() {
  const t = useT();
  return (decision: Decision) => (decision.allowed ? undefined : t(decision.reason));
}
