// @vitest-environment jsdom

import { Checkbox, CheckboxField } from '@nibleaf/design-system/components/ui/checkbox';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { RadioField, RadioGroup, RadioGroupItem } from '@nibleaf/design-system/components/ui/radio-group';
import { computeAccessibleDescription, computeAccessibleName } from 'dom-accessibility-api';
import { act, type ReactElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

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

// What assistive tech computes (accname / description), not the nearby text.
const nameOf = (el: Element) => computeAccessibleName(el);
const descriptionOf = (el: Element) => computeAccessibleDescription(el);
/** Text a sighted person can read: not inside a `hidden` element. */
const visibleText = (container: Element) =>
  [...container.querySelectorAll('[data-slot="disabled-reason"]')].filter((el) => !el.closest('[hidden]')).map((el) => el.textContent);
const click = (el: Element) => act(async () => (el as HTMLElement).click());
const key = (el: Element, k: string) =>
  act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, cancelable: true }));
  });

function ControlledCheckbox(props: { indeterminate?: boolean; disabledReason?: string; disabled?: boolean; onChange?: (checked: boolean) => void }) {
  const [checked, setChecked] = useState(false);
  return (
    <CheckboxField
      checked={checked}
      description="Readers on this site can request access."
      disabled={props.disabled}
      disabledReason={props.disabledReason}
      indeterminate={props.indeterminate}
      label="Access requests"
      onCheckedChange={(next) => {
        setChecked(next);
        props.onChange?.(next);
      }}
    />
  );
}

describe('Checkbox', () => {
  it('is a named checkbox with its description, and the whole row toggles it', async () => {
    const container = await render(<ControlledCheckbox />);
    const box = container.querySelector('[role="checkbox"]') as HTMLElement;
    expect(box.getAttribute('aria-checked')).toBe('false');
    // The name is the label alone: the description isn't announced twice.
    expect(nameOf(box)).toBe('Access requests');
    expect(descriptionOf(box)).toBe('Readers on this site can request access.');
    await click(container.querySelector('label span') as HTMLElement);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(box.querySelector('[data-slot="checkbox-indicator"] svg')).not.toBeNull();
  });

  it('toggles with Space, as a native checkbox does', async () => {
    const container = await render(<ControlledCheckbox />);
    const box = container.querySelector('[role="checkbox"]') as HTMLElement;
    await act(async () => box.focus());
    await key(box, ' ');
    expect(box.getAttribute('aria-checked')).toBe('true');
  });

  it('shows the mixed state for a parent of some ticked items', async () => {
    const container = await render(<Checkbox aria-label="All websites" checked={false} indeterminate />);
    const box = container.querySelector('[role="checkbox"]') as HTMLElement;
    expect(box.getAttribute('aria-checked')).toBe('mixed');
    expect(nameOf(box)).toBe('All websites');
    expect(box.hasAttribute('data-indeterminate')).toBe(true);
    expect(box.querySelector('[data-slot="checkbox-indicator"] svg')).not.toBeNull();
  });

  it('works with an id and a separate <label htmlFor>', async () => {
    const onChange = vi.fn();
    const container = await render(
      <>
        <Checkbox id="site-docs" onCheckedChange={onChange} />
        <label htmlFor="site-docs">Docs</label>
      </>,
    );
    expect(nameOf(container.querySelector('[role="checkbox"]') as HTMLElement)).toBe('Docs');
    await click(container.querySelector('label') as HTMLElement);
    expect(onChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('stays reachable with a disabled reason, says why, and does not change', async () => {
    const onChange = vi.fn();
    const container = await render(<ControlledCheckbox disabledReason="Only Admins can change this." onChange={onChange} />);
    const box = container.querySelector('[role="checkbox"]') as HTMLElement;
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(box.hasAttribute('data-disabled')).toBe(false);
    expect(box.tabIndex).toBe(0);
    expect(nameOf(box)).toBe('Access requests');
    expect(descriptionOf(box)).toBe('Readers on this site can request access. Only Admins can change this.');
    // Shown under the label, not only announced.
    expect(visibleText(container)).toEqual(['Only Admins can change this.']);
    await click(box);
    await act(async () => box.focus());
    await key(box, ' ');
    expect(onChange).not.toHaveBeenCalled();
    expect(box.getAttribute('aria-checked')).toBe('false');
  });

  it('lets a plain disabled win over a reason, as a skipped control', async () => {
    const container = await render(<ControlledCheckbox disabled disabledReason="ignored" />);
    const box = container.querySelector('[role="checkbox"]') as HTMLElement;
    expect(box.hasAttribute('data-disabled')).toBe(true);
    expect(container.querySelector('[data-slot="disabled-reason"]')).toBeNull();
  });
});

function Roles() {
  const [value, setValue] = useState('member');
  return (
    <DirectionProvider direction="ltr">
      <div dir="ltr">
        <RadioGroup description="What they can do on this website." label="Role" onValueChange={(next) => setValue(next as string)} value={value}>
          <RadioField description="Reads everything." label="Viewer" value="viewer" />
          <RadioField description="Writes pages." label="Member" value="member" />
          <RadioField disabledReason="Only an Owner can make someone an Admin." label="Admin" value="admin" />
        </RadioGroup>
      </div>
    </DirectionProvider>
  );
}

describe('RadioGroup', () => {
  const radios = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[role="radio"]')];
  const checked = (container: HTMLElement) => radios(container).map((radio) => radio.getAttribute('aria-checked'));

  it('is a labelled, described group of named radios', async () => {
    const container = await render(<Roles />);
    const group = container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(nameOf(group)).toBe('Role');
    expect(radios(container).map(nameOf)).toEqual(['Viewer', 'Member', 'Admin']);
    expect(descriptionOf(radios(container)[0] as HTMLElement)).toBe('Reads everything.');
    expect(checked(container)).toEqual(['false', 'true', 'false']);
  });

  // Arrow keys pass over an unavailable item, so its reason must be reachable another way.
  it("makes an unavailable choice's reason discoverable: shown under it, and read with the group", async () => {
    const container = await render(<Roles />);
    const group = container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(visibleText(container)).toEqual(['Only an Owner can make someone an Admin.']);
    expect(descriptionOf(group)).toBe('What they can do on this website. Only an Owner can make someone an Admin.');
  });

  it('drops a reason from the group once the choice is available again', async () => {
    function Toggle() {
      const [locked, setLocked] = useState(true);
      return (
        <>
          <button onClick={() => setLocked(false)} type="button">
            unlock
          </button>
          <RadioGroup defaultValue="viewer" label="Role">
            <RadioField label="Viewer" value="viewer" />
            <RadioField disabledReason={locked ? 'Only an Owner can.' : undefined} label="Admin" value="admin" />
          </RadioGroup>
        </>
      );
    }
    const container = await render(<Toggle />);
    const group = container.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(descriptionOf(group)).toBe('Only an Owner can.');
    await click(container.querySelector('button') as HTMLElement);
    expect(descriptionOf(group)).toBe('');
  });

  it('chooses an item by clicking its row', async () => {
    const container = await render(<Roles />);
    await click(radios(container)[0]?.closest('label')?.querySelector('[id]') as HTMLElement);
    expect(checked(container)).toEqual(['true', 'false', 'false']);
  });

  it('is one tab stop, on the chosen item', async () => {
    const container = await render(<Roles />);
    expect(radios(container).map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('moves and chooses with the arrow keys', async () => {
    const container = await render(<Roles />);
    const member = radios(container)[1] as HTMLElement;
    await act(async () => member.focus());
    await key(member, 'ArrowUp');
    expect(checked(container)).toEqual(['true', 'false', 'false']);
    expect(document.activeElement).toBe(radios(container)[0]);
  });

  /** Three plain choices in a row, starting on the middle one. */
  function Sizes({ dir }: { dir: 'ltr' | 'rtl' }) {
    const [value, setValue] = useState('m');
    return (
      <DirectionProvider direction={dir}>
        <div dir={dir}>
          <RadioGroup aria-label="Size" onValueChange={(next) => setValue(next as string)} value={value}>
            <RadioField label="Small" value="s" />
            <RadioField label="Medium" value="m" />
            <RadioField label="Large" value="l" />
          </RadioGroup>
        </div>
      </DirectionProvider>
    );
  }

  it.each([
    ['ltr', ['false', 'false', 'true']],
    ['rtl', ['true', 'false', 'false']],
  ] as const)('follows the reading direction with ArrowRight (%s)', async (dir, expected) => {
    const container = await render(<Sizes dir={dir} />);
    const medium = radios(container)[1] as HTMLElement;
    await act(async () => medium.focus());
    await key(medium, 'ArrowRight');
    expect(checked(container)).toEqual(expected);
  });

  it('announces an item with a reason as unavailable, says why, and never chooses it', async () => {
    const container = await render(<Roles />);
    const admin = radios(container)[2] as HTMLElement;
    expect(admin.getAttribute('aria-disabled')).toBe('true');
    expect(descriptionOf(admin)).toBe('Only an Owner can make someone an Admin.');
    await click(admin);
    await click(admin.closest('label')?.querySelector('[id]') as HTMLElement);
    expect(checked(container)).toEqual(['false', 'true', 'false']);
    // Arrow keys pass over an unavailable choice, as they do over a disabled one.
    const member = radios(container)[1] as HTMLElement;
    await act(async () => member.focus());
    await key(member, 'ArrowDown');
    expect(checked(container)).toEqual(['true', 'false', 'false']);
  });

  it('renders on the server', () => {
    const markup = renderToStaticMarkup(
      <RadioGroup aria-label="Role" defaultValue="viewer">
        <RadioGroupItem aria-label="Viewer" value="viewer" />
      </RadioGroup>,
    );
    expect(markup).toContain('role="radiogroup"');
    expect(renderToStaticMarkup(<Checkbox aria-label="Docs" defaultChecked />)).toContain('role="checkbox"');
  });
});
