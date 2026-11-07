import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import type { Editor } from '@tiptap/core';
import { Minus, Plus, X } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { hasIcon, PAGE_ICONS, PageIcon } from '@/components/site/page-icon';
import { useLinkablePages } from '../extensions/page-link-picker';
import { IsolatedText, isolate } from './bidi';

/**
 * Field controls of the component settings panel. Each one edits a single
 * attribute value: `onChange` applies a finished value as one undo step;
 * `onPreview`/`onFinish` apply typing live and fold it into one undo step when
 * the field is left.
 */
export interface FieldProps<Value> {
  id: string;
  label: string;
  hint?: string;
  value: Value;
  onChange: (value: Value) => void;
  onPreview: (value: Value) => void;
  onFinish: () => void;
}

/** Label above, control, one-line hint below (announced with the control). */
function FieldShell({
  id,
  label,
  hint,
  children,
  inline = false,
  labelAs = 'label',
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
  inline?: boolean;
  labelAs?: 'label' | 'span';
}) {
  const LabelTag = labelAs;
  return (
    <div className={cn('grid gap-1.5', inline && 'grid-cols-[1fr_auto] items-center gap-x-3')} data-settings-field="">
      <LabelTag {...(labelAs === 'label' ? { htmlFor: id } : { id: `${id}-label` })} className="font-medium text-sm leading-tight">
        {label}
      </LabelTag>
      {inline ? children : <div className="min-w-0">{children}</div>}
      {hint ? (
        <p id={`${id}-hint`} className={cn('m-0 text-muted-foreground text-xs leading-snug', inline && 'col-span-2')}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, extra?: string) => [hint ? `${id}-hint` : '', extra ?? ''].filter(Boolean).join(' ') || undefined;

/** Local draft for a text control: follows the node value until the writer types. */
function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return { draft, setDraft, editing };
}

const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    event.currentTarget.blur();
  }
};

export function TextField({ id, label, hint, value, onPreview, onFinish, dir = 'auto' }: FieldProps<string> & { dir?: 'auto' | 'ltr' }) {
  const { draft, setDraft, editing } = useDraft(value);
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <Input
        id={id}
        dir={dir}
        value={draft}
        aria-describedby={describedBy(id, hint)}
        onFocus={() => {
          editing.current = true;
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          onPreview(event.target.value);
        }}
        onBlur={() => {
          editing.current = false;
          onFinish();
        }}
        onKeyDown={blurOnEnter}
      />
    </FieldShell>
  );
}

/** A value written as code in source mode (`{flags.cols}`): shown, never edited here. */
export function ExpressionField({ id, label, value, onChange }: Pick<FieldProps<string>, 'id' | 'label' | 'value' | 'onChange'>) {
  const t = useT();
  return (
    <FieldShell id={id} label={label} hint={t('editor.componentSettings.expression')}>
      <div className="flex items-center gap-2">
        <Input id={id} dir="ltr" value={value} readOnly aria-describedby={`${id}-hint`} className="font-mono" />
        <Button type="button" variant="outline" size="sm" onClick={() => onChange('')}>
          {t('editor.componentSettings.clear')}
        </Button>
      </div>
    </FieldShell>
  );
}

export function SwitchField({ id, label, hint, value, onChange }: FieldProps<boolean>) {
  return (
    <FieldShell id={id} label={label} hint={hint} inline>
      <Switch id={id} checked={value} onCheckedChange={(checked) => onChange(checked)} aria-describedby={describedBy(id, hint)} />
    </FieldShell>
  );
}

export function NumberField({
  id,
  label,
  hint,
  value,
  onChange,
  onPreview,
  onFinish,
  min,
  max,
  offset = 0,
  placeholder,
}: FieldProps<string> & { min?: number; max?: number; offset?: number; placeholder?: string }) {
  const t = useT();
  // `offset` shows a zero-based value one-based (the first tab is "1").
  const shown = value === '' || Number.isNaN(Number(value)) ? '' : String(Number(value) + offset);
  const { draft, setDraft, editing } = useDraft(shown);
  const low = min === undefined ? undefined : min + offset;
  const high = max === undefined ? undefined : max + offset;
  const clamp = (number: number) => Math.min(high ?? Number.POSITIVE_INFINITY, Math.max(low ?? Number.NEGATIVE_INFINITY, number));
  const stored = (text: string): string => {
    if (text.trim() === '') return '';
    const number = Number(text);
    return Number.isFinite(number) ? String(clamp(Math.round(number)) - offset) : value;
  };
  const step = (delta: number) => {
    const base = draft === '' ? (low ?? 0) - (delta > 0 ? 1 : -1) : Number(draft);
    onChange(String(clamp(Math.round(base) + delta) - offset));
  };
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <div className="flex items-center gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t('editor.componentSettings.number.decrease')}
          aria-controls={id}
          disabled={low !== undefined && draft !== '' && Number(draft) <= low}
          onClick={() => step(-1)}
        >
          <Minus aria-hidden />
        </Button>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          dir="ltr"
          min={low}
          max={high}
          placeholder={placeholder}
          value={draft}
          aria-describedby={describedBy(id, hint)}
          className="w-20 text-center"
          onFocus={() => {
            editing.current = true;
          }}
          onChange={(event) => {
            setDraft(event.target.value);
            onPreview(stored(event.target.value));
          }}
          onBlur={() => {
            editing.current = false;
            setDraft(stored(draft) === '' ? '' : String(Number(stored(draft)) + offset));
            onFinish();
          }}
          onKeyDown={blurOnEnter}
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t('editor.componentSettings.number.increase')}
          aria-controls={id}
          disabled={high !== undefined && draft !== '' && Number(draft) >= high}
          onClick={() => step(1)}
        >
          <Plus aria-hidden />
        </Button>
      </div>
    </FieldShell>
  );
}

const UNSET = '__unset__';

export function SelectField({
  id,
  label,
  hint,
  value,
  onChange,
  options,
  defaultValue,
}: FieldProps<string> & { options: ReadonlyArray<{ value: string; label: string }>; defaultValue?: string }) {
  const t = useT();
  const items = useMemo(
    () => [
      ...(defaultValue === undefined ? [{ value: UNSET, label: t('editor.componentSettings.notSet') }] : []),
      ...options.map((option) =>
        option.value === defaultValue ? { ...option, label: t('editor.componentSettings.defaultOption', { value: option.label }) } : option,
      ),
    ],
    [defaultValue, options, t],
  );
  // An authored value outside the list (from source mode) stays visible.
  const known = items.some((item) => item.value === value);
  const allItems = value && !known ? [...items, { value, label: value }] : items;
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <Select
        items={allItems}
        value={value || defaultValue || UNSET}
        onValueChange={(next) => onChange(next === UNSET || next == null ? '' : String(next))}
      >
        <SelectTrigger id={id} className="w-full" aria-describedby={describedBy(id, hint)}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allItems.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

const LINK = /^(?:\/(?!\/)|#|\.{1,2}\/|https?:\/\/[^\s/]|mailto:|tel:)\S*$/i;
/** A link the reader can follow: a site path, an anchor, a relative path, or a web, mail or phone address. */
const isValidLink = (value: string): boolean => value === '' || LINK.test(value.trim());
const looksExternal = (value: string) => /^(?:https?:|mailto:|tel:|#)/i.test(value.trim());

type LinkablePage = ReturnType<typeof useLinkablePages>[number];

/** The site pages matching the typed text, as a listbox the link input controls. */
function PageSuggestions({
  editor,
  query,
  listId,
  active,
  pagesRef,
  onPick,
}: {
  editor: Editor;
  query: string;
  listId: string;
  active: number;
  /** The rendered matches, read by the input's keyboard handling. */
  pagesRef: { current: readonly LinkablePage[] };
  onPick: (href: string) => void;
}) {
  const t = useT();
  const headingId = useId();
  const pages = useLinkablePages(editor, query.replace(/^\//, ''));
  pagesRef.current = pages;
  return (
    <div className="mt-1.5 rounded-md border border-border">
      <p id={headingId} className="m-0 px-2 pt-1.5 font-medium text-muted-foreground text-xs">
        {t('editor.componentSettings.url.pages')}
      </p>
      {pages.length === 0 ? (
        <p className="m-0 px-2 py-1.5 text-muted-foreground text-xs" role="status">
          {t('editor.componentSettings.url.noPages')}
        </p>
      ) : (
        <div id={listId} role="listbox" aria-labelledby={headingId} className="p-1">
          {pages.map((page, index) => (
            // Focus stays in the input (aria-activedescendant); the pointer picks with a click.
            <div
              key={page.id}
              tabIndex={-1}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={cn('cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-muted', index === active && 'bg-muted')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(`/${page.path}`)}
            >
              <span className="block truncate" dir="auto">
                {page.title}
              </span>
              <span className="block truncate text-muted-foreground text-xs" dir="ltr">
                /{page.path}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * A link input with site-page suggestions (an ARIA combobox): ArrowDown/ArrowUp
 * move through the pages, Enter picks one, Escape closes the list without
 * closing the panel. The link is checked when the writer leaves the field or
 * presses Enter — never while typing, and never while suggestions are shown.
 */
export function UrlField({
  id,
  label,
  hint,
  value,
  onChange,
  onPreview,
  onFinish,
  editor,
  pagePicker = true,
}: FieldProps<string> & { editor: Editor; pagePicker?: boolean }) {
  const t = useT();
  const { draft, setDraft, editing } = useDraft(value);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState(false);
  const listId = useId();
  const pagesRef = useRef<readonly LinkablePage[]>([]);
  const suggesting = pagePicker && listOpen && !looksExternal(draft);
  const pages = suggesting ? pagesRef.current : [];
  const activeOption = suggesting && active >= 0 && active < pages.length ? `${listId}-${active}` : undefined;
  const container = useRef<HTMLDivElement>(null);
  const check = () => setError(!isValidLink(draft));
  const pick = (href: string) => {
    editing.current = false;
    setDraft(href);
    setError(false);
    setListOpen(false);
    setActive(-1);
    onChange(href);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = pagesRef.current.length;
    if (pagePicker && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      if (!listOpen) {
        setListOpen(true);
        setActive(event.key === 'ArrowDown' ? 0 : count - 1);
        return;
      }
      if (count === 0) return;
      setActive((current) => (event.key === 'ArrowDown' ? (current + 1) % count : (current <= 0 ? count : current) - 1));
      return;
    }
    if (event.key === 'Escape' && suggesting) {
      // Close only the list; the panel stays open.
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setListOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Enter picks the highlighted page; with none highlighted, text that is not a
      // link yet ("Install") takes the first suggestion instead of an error.
      const index = active >= 0 ? active : isValidLink(draft) ? -1 : 0;
      const page = suggesting && index >= 0 ? pagesRef.current[index] : undefined;
      if (page) {
        pick(`/${page.path}`);
        return;
      }
      setListOpen(false);
      check();
    }
  };
  return (
    <FieldShell id={id} label={label} hint={hint}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: blur bubbles here so moving between the link input and its page suggestions counts as one edit. */}
      <div
        ref={container}
        onBlur={(event) => {
          if (container.current?.contains(event.relatedTarget as Node | null)) return;
          setListOpen(false);
          setActive(-1);
          editing.current = false;
          check();
          onFinish();
        }}
      >
        <Input
          id={id}
          dir="ltr"
          inputMode="url"
          autoComplete="off"
          value={draft}
          placeholder={t('editor.componentSettings.url.placeholder')}
          {...(pagePicker
            ? {
                role: 'combobox',
                'aria-autocomplete': 'list' as const,
                'aria-expanded': suggesting,
                'aria-controls': listId,
                'aria-activedescendant': activeOption,
              }
            : {})}
          aria-invalid={error || undefined}
          aria-describedby={describedBy(id, hint, error ? `${id}-error` : undefined)}
          onFocus={() => {
            editing.current = true;
            setListOpen(true);
          }}
          onChange={(event) => {
            const next = event.target.value;
            setDraft(next);
            setError(false);
            setListOpen(true);
            setActive(-1);
            // Only a followable link reaches the document.
            if (isValidLink(next)) onPreview(next.trim());
          }}
          onKeyDown={onKeyDown}
        />
        {error && !suggesting ? (
          <p id={`${id}-error`} className="m-0 mt-1 text-destructive text-xs" role="alert">
            {t('editor.componentSettings.url.invalid')}
          </p>
        ) : null}
        {suggesting ? <PageSuggestions editor={editor} query={draft} listId={listId} active={active} pagesRef={pagesRef} onPick={pick} /> : null}
      </div>
    </FieldShell>
  );
}

const EMOJI = /\p{Extended_Pictographic}/u;

/** One entry per distinct icon (the map also holds aliases such as `house` for `home`). */
const ICON_CHOICES: readonly string[] = (() => {
  const seen = new Set<unknown>();
  return Object.entries(PAGE_ICONS).flatMap(([name, icon]) => {
    if (seen.has(icon)) return [];
    seen.add(icon);
    return [name];
  });
})();

/** Columns of the rendered icon grid: the options sharing the first one's row (one when nothing is laid out). */
const gridColumns = (grid: HTMLElement | null): number => {
  const options = [...(grid?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
  const first = options[0];
  if (!first || first.offsetHeight === 0) return 1;
  return Math.max(1, options.filter((option) => option.offsetTop === first.offsetTop).length);
};

/**
 * Icon picker. The search box drives the results grid (an ARIA combobox over a
 * listbox): typing filters, Enter picks the highlighted icon (the first match
 * until the arrows move), arrow keys move through the grid — Left/Right follow
 * the reading direction — and Ctrl+Home/Ctrl+End jump to the ends.
 */
export function IconField({ id, label, hint, value, onChange, onPreview, onFinish }: FieldProps<string>) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const pickerId = useId();
  const listId = `${pickerId}-icons`;
  const grid = useRef<HTMLDivElement>(null);
  const emoji = useDraft(EMOJI.test(value) ? value : '');
  const needle = query.trim().toLowerCase().replace(/\s+/g, '-');
  const matches = ICON_CHOICES.filter((name) => name.includes(needle));
  const highlighted = Math.min(active, matches.length - 1);
  const known = value === '' || hasIcon(value) || EMOJI.test(value);
  const choose = (name: string) => {
    onChange(name);
    setOpen(false);
    document.getElementById(id)?.focus();
  };
  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const last = matches.length - 1;
    if (event.key === 'Enter') {
      event.preventDefault();
      const name = matches[Math.max(0, highlighted)];
      if (name) choose(name);
      return;
    }
    if (event.key === 'Escape' && open) {
      // Close the picker, not the whole panel.
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      setOpen(false);
      document.getElementById(id)?.focus();
      return;
    }
    if (last < 0) return;
    // The grid flows in the panel's direction (the search box itself is dir="auto").
    const rtl = event.currentTarget.parentElement?.closest('[dir="rtl"], [dir="ltr"]')?.getAttribute('dir') === 'rtl';
    const columns = gridColumns(grid.current);
    const steps: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      ArrowDown: columns,
      ArrowUp: -columns,
    };
    let next: number | undefined;
    if (event.key in steps) next = Math.min(last, Math.max(0, Math.max(0, highlighted) + (steps[event.key] ?? 0)));
    else if (event.key === 'Home' && event.ctrlKey) next = 0;
    else if (event.key === 'End' && event.ctrlKey) next = last;
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    document.getElementById(`${listId}-${next}`)?.scrollIntoView?.({ block: 'nearest' });
  };
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Button
            id={id}
            type="button"
            variant="outline"
            className="min-w-0 flex-1 justify-start"
            aria-expanded={open}
            aria-controls={pickerId}
            aria-describedby={describedBy(id, hint, known ? undefined : `${id}-unknown`)}
            onClick={() => {
              setOpen((current) => !current);
              setActive(0);
            }}
          >
            <span className="grid size-5 place-items-center" aria-hidden>
              {hasIcon(value) ? <PageIcon name={value} className="size-4" /> : EMOJI.test(value) ? value : null}
            </span>
            <span className="truncate">
              {value ? (
                <IsolatedText translate={(slots) => t('editor.componentSettings.icon.change', slots)} values={{ name: value }} />
              ) : (
                t('editor.componentSettings.icon.choose')
              )}
            </span>
          </Button>
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
              {t('editor.componentSettings.clear')}
            </Button>
          ) : null}
        </div>
        {known ? null : (
          <p id={`${id}-unknown`} className="m-0 text-amber-700 text-xs dark:text-amber-400">
            {t('editor.componentSettings.icon.unknown')}
          </p>
        )}
        <div id={pickerId} hidden={!open} className="grid gap-2 rounded-md border border-border p-2">
          {open ? (
            <>
              <Input
                type="search"
                dir="auto"
                density="compact"
                value={query}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open && matches.length > 0}
                aria-controls={listId}
                aria-activedescendant={open && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
                aria-label={t('editor.componentSettings.icon.search')}
                placeholder={t('editor.componentSettings.icon.search')}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onSearchKeyDown}
              />
              {matches.length === 0 ? (
                <p className="m-0 text-muted-foreground text-xs" role="status">
                  {t('editor.componentSettings.icon.none')}
                </p>
              ) : (
                <div
                  ref={grid}
                  id={listId}
                  role="listbox"
                  aria-label={label}
                  className="grid max-h-44 grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] gap-1 overflow-y-auto"
                >
                  {matches.map((name, index) => (
                    // Focus stays in the search box (aria-activedescendant); the pointer picks with a click.
                    <div
                      key={name}
                      tabIndex={-1}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-label={name}
                      aria-selected={index === highlighted}
                      data-current={value === name ? '' : undefined}
                      title={name}
                      className={cn(
                        'grid aspect-square cursor-pointer place-items-center rounded-md border border-transparent hover:bg-muted',
                        index === highlighted && 'border-ring bg-muted',
                        value === name && 'border-primary bg-primary/10 text-primary',
                      )}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(name)}
                    >
                      <PageIcon name={name} className="size-4" />
                    </div>
                  ))}
                </div>
              )}
              <div className="grid gap-1 text-xs">
                <label htmlFor={`${pickerId}-emoji`} className="text-muted-foreground">
                  {t('editor.componentSettings.icon.emoji')}
                </label>
                <Input
                  id={`${pickerId}-emoji`}
                  density="compact"
                  className="w-24 text-center"
                  maxLength={16}
                  value={emoji.draft}
                  onFocus={() => {
                    emoji.editing.current = true;
                  }}
                  onChange={(event) => {
                    emoji.setDraft(event.target.value);
                    onPreview(event.target.value.trim());
                  }}
                  onBlur={() => {
                    emoji.editing.current = false;
                    onFinish();
                  }}
                  onKeyDown={blurOnEnter}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </FieldShell>
  );
}

/** Swatch values: the attribute's named colors, else these hex presets. */
const HEX_PRESETS: ReadonlyArray<{ value: string; name: string }> = [
  { value: '#2563eb', name: 'blue' },
  { value: '#16a34a', name: 'green' },
  { value: '#ea580c', name: 'orange' },
  { value: '#dc2626', name: 'red' },
  { value: '#7c3aed', name: 'purple' },
  { value: '#db2777', name: 'pink' },
  { value: '#0d9488', name: 'teal' },
  { value: '#475569', name: 'gray' },
];
/** Previews of Mintlify's named badge colors (the reader maps them to theme tokens). */
const NAMED_PREVIEW: Readonly<Record<string, string>> = {
  gray: '#6b7280',
  blue: '#3b82f6',
  green: '#16a34a',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#dc2626',
  purple: '#a855f7',
  white: '#ffffff',
  surface: '#f4f4f5',
  'white-destructive': '#ffffff',
  'surface-destructive': '#f4f4f5',
};
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const camel = (value: string) => value.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());

export function ColorField({ id, label, hint, value, onChange, onPreview, onFinish, named }: FieldProps<string> & { named?: readonly string[] }) {
  const t = useT();
  const swatches = named ? named.map((name) => ({ value: name, name })) : HEX_PRESETS;
  const { draft, setDraft, editing } = useDraft(named?.includes(value) ? '' : value);
  const valid = draft === '' || HEX.test(draft.trim());
  return (
    <FieldShell id={id} label={label} hint={hint} labelAs="span">
      <div className="grid gap-2">
        <fieldset
          className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0"
          aria-labelledby={`${id}-label`}
          aria-describedby={describedBy(id, hint)}
        >
          {swatches.map((swatch) => {
            const preview = named ? (NAMED_PREVIEW[swatch.value] ?? swatch.value) : swatch.value;
            const selected = value.toLowerCase() === swatch.value.toLowerCase();
            return (
              <button
                key={swatch.value}
                type="button"
                aria-pressed={selected}
                aria-label={t(`editor.componentSettings.option.color.${camel(swatch.name)}` as MessageKey)}
                title={t(`editor.componentSettings.option.color.${camel(swatch.name)}` as MessageKey)}
                className={cn(
                  'relative grid size-7 place-items-center rounded-full border border-border ring-offset-2 ring-offset-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected && 'ring-2 ring-primary',
                )}
                style={{ background: preview }}
                onClick={() => {
                  setDraft(named ? '' : swatch.value);
                  onChange(swatch.value);
                }}
              >
                {swatch.value.endsWith('destructive') ? <span className="size-2 rounded-full bg-red-600" aria-hidden /> : null}
              </button>
            );
          })}
        </fieldset>
        <div className="flex items-center gap-2">
          <label htmlFor={id} className="sr-only">
            {t('editor.componentSettings.color.custom')}
          </label>
          <span
            className="size-7 shrink-0 rounded-md border border-border"
            style={{ background: valid && draft ? draft : 'transparent' }}
            aria-hidden
          />
          <Input
            id={id}
            dir="ltr"
            density="compact"
            placeholder={t('editor.componentSettings.color.custom')}
            value={draft}
            aria-invalid={!valid || undefined}
            aria-describedby={valid ? undefined : `${id}-error`}
            onFocus={() => {
              editing.current = true;
            }}
            onChange={(event) => {
              const next = event.target.value.trim();
              setDraft(event.target.value);
              if (next === '' || HEX.test(next)) onPreview(next);
            }}
            onBlur={() => {
              editing.current = false;
              if (!valid) setDraft(named?.includes(value) ? '' : value);
              onFinish();
            }}
            onKeyDown={blurOnEnter}
          />
          {value ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
              {t('editor.componentSettings.clear')}
            </Button>
          ) : null}
        </div>
        {valid ? null : (
          <p id={`${id}-error`} className="m-0 text-destructive text-xs" role="alert">
            {t('editor.componentSettings.color.invalid')}
          </p>
        )}
      </div>
    </FieldShell>
  );
}

export function ListField({ id, label, hint, value, onChange }: FieldProps<readonly string[]>) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const add = () => {
    const items = draft
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item && !value.includes(item));
    if (items.length > 0) onChange([...value, ...items]);
    setDraft('');
  };
  return (
    <FieldShell id={id} label={label} hint={hint}>
      <div className="grid gap-2">
        {value.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={label}>
            {value.map((item) => (
              <li key={item} className="inline-flex items-center gap-1 rounded-md bg-muted py-0.5 ps-2 pe-0.5 text-xs" dir="auto">
                {item}
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded hover:bg-background focus-visible:outline-2 focus-visible:outline-ring"
                  aria-label={t('editor.componentSettings.list.remove', { item: isolate(item) })}
                  onClick={() => onChange(value.filter((entry) => entry !== item))}
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center gap-2">
          <Input
            id={id}
            dir="auto"
            density="compact"
            value={draft}
            placeholder={t('editor.componentSettings.list.placeholder')}
            aria-describedby={describedBy(id, hint)}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add();
              }
            }}
            onBlur={add}
          />
          <Button type="button" variant="outline" size="sm" onClick={add} disabled={draft.trim() === ''}>
            {t('editor.componentSettings.list.add')}
          </Button>
        </div>
      </div>
    </FieldShell>
  );
}
