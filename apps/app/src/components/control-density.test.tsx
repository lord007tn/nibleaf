// @vitest-environment jsdom

import { Input } from '@nibleaf/design-system/components/ui/input';
import { SegmentedControl, SegmentedControlItem } from '@nibleaf/design-system/components/ui/segmented-control';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function render(element: React.ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

it('segmented settings actions expose selection and never submit their surrounding form', async () => {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  function Example() {
    const [value, setValue] = useState('en');
    return (
      <form onSubmit={submit}>
        <SegmentedControl density="compact" dir="rtl">
          <SegmentedControlItem active={value === 'en'} onClick={() => setValue('en')}>
            English
          </SegmentedControlItem>
          <SegmentedControlItem active={value === 'ar'} onClick={() => setValue('ar')}>
            العربية
          </SegmentedControlItem>
          <SegmentedControlItem active={false} disabled onClick={() => setValue('disabled')}>
            Unavailable
          </SegmentedControlItem>
        </SegmentedControl>
      </form>
    );
  }
  const container = await render(<Example />);
  const [english, arabic, disabled] = container.querySelectorAll('button');
  if (!(english && arabic && disabled)) throw new Error('Expected all three segment actions');
  expect(english.getAttribute('aria-pressed')).toBe('true');
  await act(async () => arabic.click());
  expect(arabic.getAttribute('aria-pressed')).toBe('true');
  expect(english.getAttribute('aria-pressed')).toBe('false');
  await act(async () => disabled.click());
  expect(arabic.getAttribute('aria-pressed')).toBe('true');
  expect(submit).not.toHaveBeenCalled();
});

it('compact input density preserves the native size attribute and typing behavior', async () => {
  const change = vi.fn();
  const container = await render(<Input aria-label="Search" density="compact" size={12} onChange={change} />);
  const input = container.querySelector('input');
  expect(input?.size).toBe(12);
  expect(input?.hasAttribute('density')).toBe(false);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'العربية');
    input?.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(input?.value).toBe('العربية');
  expect(change).toHaveBeenCalledOnce();
});
