import { Input } from '@nibleaf/design-system/components/ui/input';
import { Slider } from '@nibleaf/design-system/components/ui/slider';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { Paintbrush } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@/hooks/api';
import { useUpdateProjectConfig } from '@/hooks/api';
import { FIELD_MONO, Field, GroupLabel, SaveBar, SectionHeader, Segmented } from './shared';

const PRESETS = ['#5546e8', '#0ea5e9', '#16a34a', '#22c55e', '#eab308', '#ea580c', '#ef4444', '#db2777', '#a855f7', '#0f172a'];

// ─── Colour conversion ───────────────────────────────────────────────────────

type Hsl = { h: number; s: number; l: number };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToHsl(hex: string): Hsl | null {
  let value = hex.replace('#', '').trim();
  if (value.length === 3) {
    value = value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    return null;
  }
  const r = Number.parseInt(value.slice(0, 2), 16) / 255;
  const g = Number.parseInt(value.slice(2, 4), 16) / 255;
  const b = Number.parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex({ h, s, l }: Hsl): string {
  const sa = s / 100;
  const la = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sa * Math.min(la, 1 - la);
  const f = (n: number) => {
    const color = la - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function StylingSection({ project }: { project: Project }) {
  const t = useT();
  const updateConfig = useUpdateProjectConfig(project.id);
  const styling = project.config?.styling ?? {};

  const initial = styling.primaryColor || '#5546e8';
  const [hex, setHex] = useState(initial.toUpperCase());
  const [hsl, setHsl] = useState<Hsl>(() => hexToHsl(initial) ?? { h: 245, s: 78, l: 59 });
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(styling.theme ?? 'light');
  const [radius, setRadius] = useState<'sharp' | 'rounded' | 'pill'>(styling.radius ?? 'rounded');
  const [saving, setSaving] = useState(false);

  // Apply a fully-formed hex (from input / preset): updates both hex + sliders.
  const applyHex = (next: string) => {
    const normalized = next.startsWith('#') ? next : `#${next}`;
    setHex(normalized.toUpperCase());
    const parsed = hexToHsl(normalized);
    if (parsed) {
      setHsl(parsed);
    }
  };

  // Apply a slider change: recompute the hex from the new HSL triplet.
  const applyHsl = (next: Hsl) => {
    setHsl(next);
    setHex(hslToHex(next).toUpperCase());
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
      toast.error(t('settings.styling.invalidHex'));
      return;
    }
    setSaving(true);
    updateConfig.mutate(
      { config: { styling: { primaryColor: hex.toLowerCase(), theme, radius } } },
      {
        onSuccess: () => toast.success(t('common.saved')),
        onError: () => toast.error(t('settings.saveError')),
        onSettled: () => setSaving(false),
      },
    );
  };

  const satTrack = `linear-gradient(90deg, hsl(${hsl.h} 0% ${hsl.l}%), hsl(${hsl.h} 100% ${hsl.l}%))`;
  const lightTrack = `linear-gradient(90deg, #000, hsl(${hsl.h} ${hsl.s}% 50%), #fff)`;

  return (
    <form onSubmit={handleSubmit}>
      <SectionHeader icon={<Paintbrush className="size-4" />} title={t('settings.styling.title')} />

      <GroupLabel>{t('settings.styling.primaryColor.label')}</GroupLabel>
      <p className="mt-1 mb-3 text-[12.5px] text-muted-foreground leading-snug">{t('settings.styling.primaryColor.hint')}</p>

      <div className="mb-4 flex items-center gap-3.5">
        <span className="size-11 shrink-0 rounded-xl" style={{ background: hex, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }} />
        <Input className={cn(FIELD_MONO, 'w-[116px] uppercase')} maxLength={7} onChange={(e) => applyHex(e.target.value)} value={hex} />
        <span className="text-[12px] text-muted-foreground">{t('settings.styling.pickColor')}</span>
      </div>

      <div className="mb-4 flex flex-col gap-3.5">
        <Slider
          aria-label={t('settings.styling.hue')}
          max={360}
          min={0}
          onChange={(e) => applyHsl({ ...hsl, h: clamp(Number(e.target.value), 0, 360) })}
          track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
          value={hsl.h}
        />
        <Slider
          aria-label={t('settings.styling.saturation')}
          max={100}
          min={0}
          onChange={(e) => applyHsl({ ...hsl, s: clamp(Number(e.target.value), 0, 100) })}
          track={satTrack}
          value={hsl.s}
        />
        <Slider
          aria-label={t('settings.styling.lightness')}
          max={100}
          min={0}
          onChange={(e) => applyHsl({ ...hsl, l: clamp(Number(e.target.value), 0, 100) })}
          track={lightTrack}
          value={hsl.l}
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2.5">
        {PRESETS.map((preset) => (
          <button
            aria-label={preset}
            className={cn(
              'size-[26px] cursor-pointer rounded-full outline-none ring-offset-2 ring-offset-card transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50',
              hex.toLowerCase() === preset.toLowerCase() && 'ring-2 ring-foreground/40',
            )}
            key={preset}
            onClick={() => applyHex(preset)}
            style={{ background: preset }}
            type="button"
          />
        ))}
      </div>

      <Field hint={t('settings.styling.theme.hint')} label={t('settings.styling.theme.label')}>
        <Segmented
          className="max-w-[340px]"
          onChange={setTheme}
          options={[
            { value: 'light', label: t('settings.styling.theme.light') },
            { value: 'dark', label: t('settings.styling.theme.dark') },
            { value: 'system', label: t('settings.styling.theme.system') },
          ]}
          value={theme}
        />
      </Field>

      <Field hint={t('settings.styling.radius.hint')} label={t('settings.styling.radius.label')}>
        <Segmented
          className="max-w-[280px]"
          onChange={setRadius}
          options={[
            { value: 'sharp', label: t('settings.styling.radius.sharp') },
            { value: 'rounded', label: t('settings.styling.radius.rounded') },
            { value: 'pill', label: t('settings.styling.radius.pill') },
          ]}
          value={radius}
        />
      </Field>

      <SaveBar isSubmitting={saving} />
    </form>
  );
}
