// @vitest-environment jsdom
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api';
import { act, type ReactElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, values?: Record<string, string>) => (values ? `${key} ${Object.values(values).join(' ')}` : key),
}));

import type { GrantSelection } from '../model/members';
import { SITE_ROLE_OPTIONS, type SiteRole } from '../model/roles';
import { RoleOptionList } from './role-options';
import { WebsiteChecklist } from './website-checklist';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}
const click = (el: Element | undefined) => act(async () => (el as HTMLElement).click());
const key = (el: Element | undefined, k: string) =>
  act(async () => {
    el?.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    el?.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true }));
  });
const radios = (container: Element) => [...container.querySelectorAll<HTMLElement>('[role="radio"]')];
const checkboxes = (container: Element) => [...container.querySelectorAll<HTMLElement>('[role="checkbox"]')];

function Roles(props: { initial?: SiteRole; disabled?: boolean; unavailable?: SiteRole[]; onChange?: (role: SiteRole) => void }) {
  const [role, setRole] = useState<SiteRole>(props.initial ?? 'member');
  return (
    <RoleOptionList
      disabled={props.disabled}
      legend="Role on Docs"
      onChange={(next) => {
        setRole(next);
        props.onChange?.(next);
      }}
      options={SITE_ROLE_OPTIONS}
      unavailableReason={(option) => (props.unavailable?.includes(option) ? 'people.reason.roleAboveYours' : undefined)}
      value={role}
    />
  );
}

describe('RoleOptionList (design-system RadioGroup)', () => {
  it('is a named radio group whose options carry the role and what it can do', async () => {
    const container = await render(<Roles />);
    const group = container.querySelector('[role="radiogroup"]');
    expect(group && computeAccessibleName(group)).toBe('Role on Docs');
    const options = radios(container);
    expect(options.map((radio) => computeAccessibleName(radio))).toEqual(SITE_ROLE_OPTIONS.map((option) => option.label));
    expect(options.map((radio) => computeAccessibleDescription(radio))).toEqual(SITE_ROLE_OPTIONS.map((option) => option.description));
    expect(options.map((radio) => radio.getAttribute('aria-checked'))).toEqual(SITE_ROLE_OPTIONS.map((option) => String(option.role === 'member')));
    // No native radios left: the old `accent-primary` inputs.
    expect(container.querySelector('input[type="radio"]:not([aria-hidden="true"])')).toBeNull();
  });

  it('chooses by click on the whole row and by arrow keys', async () => {
    const onChange = vi.fn();
    const container = await render(<Roles onChange={onChange} />);
    const viewer = SITE_ROLE_OPTIONS.findIndex((option) => option.role === 'viewer');
    await click(radios(container)[viewer]?.closest('label') ?? undefined);
    expect(onChange).toHaveBeenLastCalledWith('viewer');
    const checked = () => radios(container).find((radio) => radio.getAttribute('aria-checked') === 'true');
    const before = checked();
    before?.focus();
    await key(before, before === radios(container).at(-1) ? 'ArrowUp' : 'ArrowDown');
    expect(checked()).not.toBe(before);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('keeps a role it may not give in the list, unavailable and with its reason, instead of hiding it', async () => {
    const onChange = vi.fn();
    const container = await render(<Roles onChange={onChange} unavailable={['admin']} />);
    const admin = radios(container)[SITE_ROLE_OPTIONS.findIndex((option) => option.role === 'admin')];
    expect(admin).toBeDefined();
    expect(admin?.getAttribute('aria-disabled')).toBe('true');
    expect(admin && computeAccessibleDescription(admin)).toContain('people.reason.roleAboveYours');
    // Shown, not only announced.
    const reason = [...container.querySelectorAll('[data-slot="disabled-reason"]')].find((el) => !el.closest('[hidden]'));
    expect(reason?.textContent).toBe('people.reason.roleAboveYours');
    await click(admin?.closest('label') ?? undefined);
    expect(onChange).not.toHaveBeenCalled();
    expect(admin?.getAttribute('aria-checked')).toBe('false');
  });

  it('can be disabled as a whole while saving', async () => {
    const onChange = vi.fn();
    const container = await render(<Roles disabled onChange={onChange} />);
    for (const radio of radios(container)) await click(radio);
    expect(onChange).not.toHaveBeenCalled();
  });
});

function Checklist(props: { disabled?: boolean; onChange?: (next: GrantSelection) => void }) {
  const [value, setValue] = useState<GrantSelection>({});
  return (
    <WebsiteChecklist
      defaultRole="member"
      disabled={props.disabled}
      legend="Websites"
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
      value={value}
      websites={[
        { id: 'docs', name: 'Docs' },
        { id: 'guide', name: 'دليل المنتج' },
      ]}
    />
  );
}

describe('WebsiteChecklist (design-system CheckboxField)', () => {
  it('names each checkbox by its website, ticks it with the default role and offers the role select', async () => {
    const onChange = vi.fn();
    const container = await render(<Checklist onChange={onChange} />);
    const boxes = checkboxes(container);
    expect(boxes.map((box) => computeAccessibleName(box))).toEqual(['Docs', 'دليل المنتج']);
    expect(container.querySelector('input[type="checkbox"]:not([aria-hidden="true"])')).toBeNull();
    await click(boxes[1]?.closest('label') ?? undefined);
    expect(onChange).toHaveBeenLastCalledWith({ guide: 'member' });
    expect(checkboxes(container)[1]?.getAttribute('aria-checked')).toBe('true');
    expect(container.querySelector('[aria-label="people.checklist.roleFor دليل المنتج"]')).not.toBeNull();
    await click(checkboxes(container)[1]);
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('passes `disabled` to the checkboxes (a fieldset alone would not stop them)', async () => {
    const onChange = vi.fn();
    const container = await render(<Checklist disabled onChange={onChange} />);
    for (const box of checkboxes(container)) await click(box);
    expect(onChange).not.toHaveBeenCalled();
  });
});
