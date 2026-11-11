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
   * §6.5). It stays in the tab order, announced as unavailable
   * (`aria-disabled`), ignores clicks and keys (`readOnly`), and its reason is
   * read through `aria-describedby`. A plain `disabled` wins: the control is
   * then skipped, as without a reason.
   */
  disabledReason?: React.ReactNode;
};

/**
 * For a base-ui control that supports `readOnly` (Checkbox, Radio): the props
 * that make it "disabled, with a reason", and the hidden description that
 * carries the reason. Render `reason` next to the control.
 */
export function useDisabledReason(disabled: boolean | undefined, disabledReason: React.ReactNode, describedBy: string | undefined) {
  const reasonId = React.useId();
  const hasReason = !disabled && hasContent(disabledReason);
  return {
    controlProps: hasReason ? { readOnly: true, 'aria-disabled': true as const, 'aria-describedby': joinDescribedBy(describedBy, reasonId) } : {},
    reason: hasReason ? (
      // `hidden` keeps it out of the reading order and layout while `aria-describedby` still reads it.
      <span hidden id={reasonId} data-slot="disabled-reason">
        {disabledReason}
      </span>
    ) : null,
  };
}
