import * as React from 'react';

/** Joins `aria-describedby` id lists, dropping blanks and duplicates. */
export const joinDescribedBy = (...ids: Array<string | undefined>) => {
  const unique = [...new Set(ids.flatMap((id) => (id ? id.split(/\s+/) : [])).filter(Boolean))];
  return unique.length ? unique.join(' ') : undefined;
};

export const hasContent = (node: React.ReactNode) => node != null && node !== false && node !== '';

export type DisabledReasonProps = {
  /**
   * Why the control can't be changed right now (operations/ui-overhaul.md
   * §6.5). It is announced as unavailable (`aria-disabled`), ignores clicks
   * and keys (`readOnly`), and its reason is read through `aria-describedby`.
   * The field components (`CheckboxField`, `RadioField`) also show the reason
   * as text under the label. A plain `disabled` wins: the control is then
   * skipped, as without a reason.
   */
  disabledReason?: React.ReactNode;
};

/**
 * For a base-ui control that supports `readOnly` (Checkbox, Radio): whether
 * it has a reason, the id its text goes under, and the props that make the
 * control "disabled, with a reason".
 */
export function useDisabledReason(disabled: boolean | undefined, disabledReason: React.ReactNode, describedBy: string | undefined) {
  const reasonId = React.useId();
  const hasReason = !disabled && hasContent(disabledReason);
  return {
    hasReason,
    reasonId,
    controlProps: hasReason ? { readOnly: true, 'aria-disabled': true as const, 'aria-describedby': joinDescribedBy(describedBy, reasonId) } : {},
  };
}

/**
 * The reason text. `visible` shows it as muted helper text (the field
 * components); otherwise it is `hidden`, still read through
 * `aria-describedby` but not shown.
 */
export function DisabledReasonText({ id, visible, children }: { id: string; visible?: boolean; children: React.ReactNode }) {
  return visible ? (
    <span id={id} data-slot="disabled-reason" className="mt-0.5 block text-muted-foreground">
      {children}
    </span>
  ) : (
    <span hidden id={id} data-slot="disabled-reason">
      {children}
    </span>
  );
}

/** The shared focus ring, plus an outline that only shows in forced colors (a transparent outline takes the system color there). */
export const CONTROL_FOCUS =
  'outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid focus-visible:outline-transparent';
