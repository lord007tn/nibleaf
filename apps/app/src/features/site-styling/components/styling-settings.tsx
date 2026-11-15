import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { useDirection } from '@nibleaf/design-system/components/ui/direction';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Slider } from '@nibleaf/design-system/components/ui/slider';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import type { ThemeOwnedProjectConfig } from '@nibleaf/shared/themes';
import { useStore } from '@tanstack/react-form';
import { Paintbrush } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { FIELD_MONO, GroupLabel, SectionHeader, Segmented } from '@/components/project-settings/shared';
import type { Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { SaveRegionProvider, SaveRegionSubmit, useSaveRegionForm } from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { useSaveStyling } from '../api/hooks';
import {
  clamp,
  colorProblem,
  editColor,
  HSL_MAX,
  type Hsl,
  hexText,
  hexToHsl,
  hslToHex,
  inheritedRadius,
  PRESETS,
  type Radius,
  SHOWN_DEFAULT_COLOR,
  type StylingConfig,
  type StylingValues,
  shownColor,
  shownRadius,
  stylingValues,
} from '../model/styling';

/**
 * Site configuration → Styling, in the editor's Configuration tab: the primary
 * color and the corner radius as one explicit-save draft. A save sends only
 * what changed; the appearance is the Theme section's and is never sent here.
 */
export function StylingSettings({ project }: { project: Project }) {
  return (
    <SaveRegionProvider>
      <StylingForm project={project} />
    </SaveRegionProvider>
  );
}

/**
 * State that belongs to one draft identity (one site's styling). A new identity
 * replaces it while rendering, so nothing from the previous site shows, not
 * even for one frame, and coming back to a site starts fresh.
 */
function useIdentityState<S>(identity: string, initial: S) {
  const [state, setState] = useState({ identity, value: initial });
  let current = state;
  if (state.identity !== identity) {
    current = { identity, value: initial };
    setState(current);
  }
  const update = useCallback((next: (previous: S) => S) => setState((previous) => ({ ...previous, value: next(previous.value) })), []);
  return [current.value, update] as const;
}

/** Whether the color's problem may show: once the field was left or a save was tried. */
type Reveal = { left: boolean; attempted: boolean };
const HIDDEN: Reveal = { left: false, attempted: false };

/**
 * How the controls show the draft's color while the person is working on it:
 * the text as typed (`#ABC` for `#aabbcc`) and the slider position (hue 360,
 * or the hue of a gray). It applies only while the draft still holds `value`,
 * the color it was made for: an outside change (a refetch, Use theirs,
 * Discard) shows that color instead and ends it, never a stale one.
 */
type Transient = { value: string; text?: string; hsl?: Hsl };

function StylingForm({ project }: { project: Project }) {
  const t = useT();
  const saveStyling = useSaveStyling(project.id);
  const styling = project.config?.styling as StylingConfig | undefined;
  const source = useMemo(() => stylingValues(styling), [styling]);
  // What an unset radius gets from the stored theme. Shown, never written into the draft.
  const theme = (project.config as ThemeOwnedProjectConfig | undefined)?.theme;
  const inherited = useMemo(() => inheritedRadius(theme), [theme]);
  const identity = JSON.stringify([project.id, 'styling']);
  const [reveal, setReveal] = useIdentityState(identity, HIDDEN);
  const [transient, setTransient] = useIdentityState<Transient | null>(identity, null);

  const { form, ...draft } = useServerDraftForm<StylingValues>({
    identity: [project.id, 'styling'],
    source,
    onSubmit: async (value, save) => {
      if (colorProblem(value.primaryColor)) {
        save.failed();
        return 'invalid';
      }
      try {
        // Settled clean: nothing is left to show. Otherwise (an edit made
        // meanwhile, or a conflict) the fields and their problems stay.
        if (save.succeeded(await saveStyling(value, save.baseline))) setReveal(() => HIDDEN);
        return 'saved';
      } catch (error) {
        save.failed();
        // A save for a site this form has since left says nothing here.
        if (save.isCurrent()) toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
        return 'failed';
      }
    },
  });

  const { submit: submitDraft, discard: discardDraft, isSaving } = draft;
  // Save, Enter and Ctrl+S all come through here, under the draft's one lock.
  // A try reveals the color's problem before the bar looks for it to focus.
  const submit = useCallback(async () => {
    flushSync(() => setReveal((previous) => (previous.attempted ? previous : { ...previous, attempted: true })));
    const outcome = await submitDraft();
    // The page's save bar disables Save while saving, so 'busy' only means "nothing new to report".
    return outcome === 'busy' ? 'failed' : outcome;
  }, [setReveal, submitDraft]);
  const discard = useCallback(() => {
    if (isSaving) return;
    discardDraft();
    setReveal(() => HIDDEN);
    setTransient(() => null);
  }, [discardDraft, isSaving, setReveal, setTransient]);
  const formProps = useSaveRegionForm('site-styling', {
    isDirty: draft.isDirty,
    isSubmitting: isSaving,
    submit,
    discard,
    settlement: draft.settlement,
  });

  const values = useStore(form.store, (state) => state.values);
  const color = values.primaryColor;
  const shown = shownColor(color);
  // The exact view lasts only while the draft keeps holding its color: once
  // the draft moves to another color it is dropped, so the same color coming
  // back later (from the server, say) shows its own HSL, not a stale position.
  if (transient && transient.value !== color) setTransient(() => null);
  const own = transient?.value === color ? transient : null;
  const hsl = own?.hsl ?? hexToHsl(shown ?? SHOWN_DEFAULT_COLOR) ?? { h: 0, s: 0, l: 0 };
  const text = own?.text ?? (shown ?? color).toUpperCase();
  const problem = colorProblem(color) && (reveal.left || reveal.attempted);
  const errorId = useId();
  const radiusLabelId = useId();
  const radiusSourceId = useId();

  const setColor = (next: string, view: Omit<Transient, 'value'> | null) => {
    setTransient(() => (view ? { value: next, ...view } : null));
    form.setFieldValue('primaryColor', next);
  };
  const typeColor = (typed: string) => {
    const next = editColor(typed, draft.baseline.primaryColor);
    // While the text is not a color, the sliders stay where they were.
    setColor(next, { text: hexText(typed), ...(shownColor(next) ? {} : { hsl }) });
  };
  const slide = (channel: keyof Hsl, raw: string) => {
    const next = { ...hsl, [channel]: clamp(Number(raw), 0, HSL_MAX[channel]) };
    // The sliders keep their exact position: it is not read back from the rounded color.
    setColor(editColor(hslToHex(next), draft.baseline.primaryColor), { hsl: next });
  };

  // Slider thumbs travel start→end, so the track gradient must follow the writing direction.
  const angle = useDirection() === 'rtl' ? 270 : 90;
  const hueTrack = `linear-gradient(${angle}deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)`;
  const satTrack = `linear-gradient(${angle}deg, hsl(${hsl.h} 0% ${hsl.l}%), hsl(${hsl.h} 100% ${hsl.l}%))`;
  const lightTrack = `linear-gradient(${angle}deg, #000, hsl(${hsl.h} ${hsl.s}% 50%), #fff)`;
  const sliders = [
    { channel: 'h', label: t('settings.styling.hue'), track: hueTrack },
    { channel: 's', label: t('settings.styling.saturation'), track: satTrack },
    { channel: 'l', label: t('settings.styling.lightness'), track: lightTrack },
  ] as const;

  return (
    <form noValidate {...formProps}>
      <SaveRegionSubmit />
      <SectionHeader icon={<Paintbrush className="size-4" />} title={t('settings.styling.title')} />

      {draft.conflicts.length > 0 ? (
        <Callout
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  for (const key of draft.conflicts) draft.resolveConflict(key, 'theirs');
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {t('forms.useTheirs')}
              </Button>
              <Button
                onClick={() => {
                  for (const key of draft.conflicts) draft.resolveConflict(key, 'mine');
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('forms.keepMine')}
              </Button>
            </div>
          }
          className="mb-4"
          tone="warning"
        >
          {t('forms.changedElsewhere')}
        </Callout>
      ) : null}

      <GroupLabel>{t('settings.styling.primaryColor.label')}</GroupLabel>
      <p className="mt-1 mb-3 text-muted-foreground text-xs leading-snug">{t('settings.styling.primaryColor.hint')}</p>

      <div className="mb-4">
        <div className="flex flex-wrap items-center gap-3.5">
          {/* While the text is not a color, the swatch keeps the sliders' color. */}
          <span
            aria-hidden
            className="size-11 shrink-0 rounded-xl"
            style={{ background: shown ?? hslToHex(hsl), boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.08)' }}
          />
          <Input
            aria-describedby={problem ? errorId : undefined}
            aria-invalid={problem || undefined}
            aria-label={t('settings.styling.primaryColor.label')}
            autoCapitalize="off"
            autoComplete="off"
            className={cn(FIELD_MONO, 'w-[116px] uppercase')}
            dir="ltr"
            maxLength={7}
            onBlur={() => {
              setReveal((previous) => (previous.left ? previous : { ...previous, left: true }));
              // A color typed short reads back in its long form once the field is left.
              setTransient((previous) => (previous?.text && shownColor(previous.value) ? { ...previous, text: undefined } : previous));
            }}
            onChange={(event) => typeColor(event.target.value)}
            spellCheck={false}
            value={text}
          />
          <span className="text-muted-foreground text-xs">{t('settings.styling.pickColor')}</span>
        </div>
        <FieldError className="mt-1.5 text-destructive text-xs" errors={problem ? [t('settings.styling.invalidHex')] : []} id={errorId} />
      </div>

      <div className="mb-4 flex flex-col gap-3.5">
        {sliders.map(({ channel, label, track }) => (
          <Slider
            aria-label={label}
            key={channel}
            max={HSL_MAX[channel]}
            min={0}
            onChange={(event) => slide(channel, event.target.value)}
            track={track}
            value={hsl[channel]}
          />
        ))}
      </div>

      <div className="mb-6 flex flex-wrap gap-2.5">
        {PRESETS.map((preset) => (
          <button
            aria-label={preset}
            aria-pressed={shown === preset}
            className={cn(
              'size-[26px] cursor-pointer rounded-full outline-none ring-offset-2 ring-offset-card transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50',
              shown === preset && 'ring-2 ring-foreground/40',
            )}
            key={preset}
            onClick={() => setColor(editColor(preset, draft.baseline.primaryColor), null)}
            style={{ background: preset }}
            type="button"
          />
        ))}
      </div>

      <form.Field name="radius">
        {(field) => (
          // Any choice, the inherited radius included, is the person's: it sets this site's own radius.
          <fieldset aria-describedby={radiusSourceId} aria-labelledby={radiusLabelId} className="mb-6 min-w-0">
            <GroupLabel>
              <span id={radiusLabelId}>{t('settings.styling.radius.label')}</span>
            </GroupLabel>
            <p className="mt-1 mb-3 text-muted-foreground text-xs leading-snug">{t('settings.styling.radius.hint')}</p>
            <Segmented<Radius>
              className="max-w-[280px]"
              onChange={(next) => field.handleChange(next)}
              options={[
                { value: 'sharp', label: t('settings.styling.radius.sharp') },
                { value: 'rounded', label: t('settings.styling.radius.rounded') },
                { value: 'pill', label: t('settings.styling.radius.pill') },
              ]}
              value={shownRadius(field.state.value, inherited)}
            />
            <p className="mt-2 text-muted-foreground text-xs leading-snug" id={radiusSourceId}>
              {field.state.value === '' ? t('settings.styling.radius.inherited') : t('settings.styling.radius.override')}
            </p>
          </fieldset>
        )}
      </form.Field>
    </form>
  );
}
