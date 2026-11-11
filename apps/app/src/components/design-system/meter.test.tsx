// @vitest-environment jsdom

import { Meter } from '@nibleaf/design-system/components/ui/meter';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

const render = (element: React.ReactElement) => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host.querySelector('[role="progressbar"]') as HTMLElement;
};

describe('Meter', () => {
  it('announces the true value while drawing a visible sliver', () => {
    const bar = render(<Meter label="Published pages used" value={0} valueText="1 of 1,000 (0.1%)" width={2} />);
    expect(bar.getAttribute('aria-label')).toBe('Published pages used');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
    expect(bar.getAttribute('aria-valuetext')).toBe('1 of 1,000 (0.1%)');
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('2%');
  });

  it('caps what it draws and announces at 100, and draws the value when no width is given', () => {
    expect(render(<Meter label="x" value={150} valueText="150 of 100" />).getAttribute('aria-valuenow')).toBe('100');
    expect((render(<Meter label="x" value={150} valueText="150 of 100" />).firstElementChild as HTMLElement).style.width).toBe('100%');
    expect((render(<Meter label="x" value={40} valueText="40 of 100" />).firstElementChild as HTMLElement).style.width).toBe('40%');
  });

  it('draws its tone as a border too, so forced colors keep the bar', () => {
    const fill = render(<Meter label="x" tone="danger" value={90} valueText="90 of 100" />).firstElementChild as HTMLElement;
    expect(fill.getAttribute('data-tone')).toBe('danger');
    expect(fill.className).toContain('border-destructive');
    expect(fill.className).toContain('border-y-[3px]');
  });
});
