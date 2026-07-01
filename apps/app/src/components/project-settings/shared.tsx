import { Button } from '@midad/design-system/components/ui/button';
import { Switch } from '@midad/design-system/components/ui/switch';
import { cn } from '@midad/design-system/lib/utils';
import type { ProjectConfig } from '@midad/validators';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { useT } from '@/lib/i18n';
import { type MessageKey, messages } from '@/lib/i18n/messages';

type ConfigMutation = {
  mutate: (vars: { config: ProjectConfig }, opts?: { onSuccess?: () => void; onError?: (error: unknown) => void }) => void;
};

// saveConfigSection is a plain helper (not a hook), so it resolves the toast
// message from the persisted locale directly — keeping every caller's save toast
// localized without threading a translator through each section.
const localized = (key: MessageKey): string => {
  let locale: 'en' | 'ar' = 'en';
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('midad.locale') === 'ar') {
      locale = 'ar';
    }
  } catch {
    // ignore storage failures
  }
  return messages[locale][key] ?? messages.en[key];
};

/**
 * Wraps `useUpdateProjectConfig(...).mutate` in a promise + toast so a TanStack
 * Form `onSubmit` can `await` it. The server deep-merges section-level config,
 * so callers pass just the one section they own (e.g. `{ footer: {...} }`).
 */
export function saveConfigSection(update: ConfigMutation, config: ProjectConfig) {
  return new Promise<void>((resolve) => {
    update.mutate(
      { config },
      {
        onSuccess: () => {
          toast.success(localized('common.saved'));
          resolve();
        },
        onError: (error) => {
          toast.error(error instanceof Error ? error.message : localized('settings.saveError'));
          resolve();
        },
      },
    );
  });
}

/**
 * Shared building blocks for the Site-configurations sections. Each section file
 * composes these to stay consistent with the design (section header rule, a
 * label + helper-text field wrapper, segmented controls and toggle rows).
 */

/** The header at the top of every section pane: a muted glyph + the title, with
 *  an optional one-line description under it. */
export function SectionHeader({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="mb-6 border-border border-b pb-3">
      <div className="flex items-center gap-2.5">
        <span className="text-base text-muted-foreground">{icon}</span>
        <h2 className="font-semibold text-lg tracking-tight">{title}</h2>
      </div>
      {description ? <p className="mt-1.5 text-[13px] text-muted-foreground leading-snug">{description}</p> : null}
    </div>
  );
}

/** A labelled form row: bold label, muted helper text, then the control. */
export function Field({
  label,
  hint,
  htmlFor,
  children,
  className,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-6', className)}>
      <label className="block font-semibold text-[13px]" htmlFor={htmlFor}>
        {label}
      </label>
      {hint ? <p className="mt-1 mb-2.5 text-[12.5px] text-muted-foreground leading-snug">{hint}</p> : <div className="mb-2.5" />}
      {children}
    </div>
  );
}

/**
 * A standalone bold group label (e.g. "Navbar links", "Primary color") that
 * heads a control group rather than labelling a single input. Rendered as a
 * non-`<label>` element so it isn't expected to associate with one control.
 */
export function GroupLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('font-semibold text-[13px]', className)}>{children}</div>;
}

/** A pill segmented control matching the chip-background design tokens. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode }>;
  className?: string;
}) {
  return (
    <div className={cn('inline-flex w-full gap-0.5 rounded-lg bg-muted p-0.5', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            className={cn(
              'h-8 flex-1 cursor-pointer rounded-md px-3 font-medium text-[13px] transition-colors',
              active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            key={option.value}
            onClick={() => onChange(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** A bordered toggle row: title + helper text on the left, a Switch on the right. */
export function ToggleRow({
  title,
  hint,
  checked,
  onCheckedChange,
}: {
  title: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-4 border-border border-t py-3.5">
      <div className="flex-1 leading-snug">
        <div className="font-medium text-[13.5px]">{title}</div>
        {hint ? <div className="mt-0.5 text-[12px] text-muted-foreground">{hint}</div> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/** The right-aligned Save button row used at the bottom of each form section. */
export function SaveBar({ isSubmitting }: { isSubmitting: boolean }) {
  const t = useT();
  return (
    <div className="mt-2 flex justify-end">
      <Button disabled={isSubmitting} type="submit">
        {isSubmitting ? t('common.saving') : t('common.save')}
      </Button>
    </div>
  );
}

/** Shared input styling tokens. These layer on top of the base `Input`/`Textarea`
 *  spec (height 36px / h-9, rounded-md, focus ring) — callers inherit that, so the
 *  tokens only carry the font and, for textareas, the taller min-height. */
export const FIELD_INPUT = 'text-sm';
export const FIELD_MONO = 'font-mono text-sm';
export const FIELD_TEXTAREA = 'min-h-[84px] text-sm';

/** Dense list-row inputs (variable/redirect/navbar rows): shorter and tighter. */
export const FIELD_COMPACT = 'h-8 rounded-md text-[13px]';
export const FIELD_COMPACT_MONO = 'h-8 rounded-md font-mono text-[13px]';
