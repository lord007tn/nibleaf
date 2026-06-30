import * as React from 'react';

import { cn } from '../../lib/utils';

/**
 * A styled `<input type="range">` slider. shadcn ships a Radix slider, but the
 * Site-configurations design uses a plain range input with a custom gradient
 * track (the HSL pickers), so this primitive keeps that exact behaviour while
 * matching the shadcn token palette.
 *
 * Pass a CSS gradient via the `track` prop to paint the rail (e.g. the hue
 * spectrum or a saturation/lightness ramp). When omitted, a neutral `--muted`
 * rail is used. The thumb reads `--background`/`--border` so it stays visible
 * on top of any track colour.
 *
 * The range-thumb/track pseudo-elements can't be expressed with Tailwind
 * utilities, so they live in a once-injected scoped `<style>` tag keyed on the
 * `pl-slider` class. This keeps the primitive self-contained.
 */
const SLIDER_CSS = `
.pl-slider{-webkit-appearance:none;appearance:none;background:var(--pl-track, var(--muted));}
.pl-slider::-webkit-slider-runnable-track{height:8px;border-radius:9999px;background:transparent;}
.pl-slider::-moz-range-track{height:8px;border-radius:9999px;background:transparent;}
.pl-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;margin-top:-5px;border-radius:9999px;background:var(--background);border:2px solid var(--border);box-shadow:0 1px 2px rgba(0,0,0,.18);cursor:pointer;}
.pl-slider::-moz-range-thumb{width:18px;height:18px;border-radius:9999px;background:var(--background);border:2px solid var(--border);box-shadow:0 1px 2px rgba(0,0,0,.18);cursor:pointer;}
`;

function SliderStyles() {
  // React 19 hoists + dedupes <style> by `href`, so multiple sliders share one tag.
  return (
    <style href="pl-slider" precedence="default">
      {SLIDER_CSS}
    </style>
  );
}

function Slider({
  className,
  track,
  style,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { track?: string }) {
  return (
    <>
      <SliderStyles />
      <input
        type="range"
        data-slot="slider"
        className={cn(
          'pl-slider h-2 w-full cursor-pointer rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
        style={{ ...(track ? ({ '--pl-track': track } as React.CSSProperties) : {}), ...style }}
        {...props}
      />
    </>
  );
}

export { Slider };

