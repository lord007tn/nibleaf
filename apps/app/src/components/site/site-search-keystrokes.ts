/*
 * Keeps every keystroke typed between asking for search (⌘K, '/', or a tap on a
 * search trigger) and the dialog's own field being ready to take it.
 *
 * The dialog's code loads on demand and its field mounts in a portal a frame or
 * more later, and focus briefly falls back to the page whenever one field hands
 * over to the next. Keys pressed in those gaps used to land on the page and
 * vanish ("cancel reservation" arrived as "c"). Instead, opening search focuses
 * a hidden real <input> at once, inside the opening key press or tap, so typing
 * (including IME composition, Arabic and every other keyboard layout) goes
 * straight into a text field. The loading shell's field holds the text while it
 * is on screen, and the dialog takes the whole buffer when its field mounts.
 */

type Capture = {
  /** Hidden field that receives keys while no visible field is on screen. */
  proxy: HTMLInputElement;
  /** The field currently holding the text: the proxy, or the loading shell's field. */
  holder: HTMLInputElement;
  composing: boolean;
  onCancel?: () => void;
  cleanup: () => void;
};

let capture: Capture | null = null;

const isEditable = (element: Element | null): boolean =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  element instanceof HTMLSelectElement ||
  (element instanceof HTMLElement && element.isContentEditable);

const focusField = (field: HTMLInputElement) => {
  field.focus({ preventScroll: true });
  const end = field.value.length;
  try {
    field.setSelectionRange(end, end);
  } catch {
    // Some input types do not support selection; the text is kept regardless.
  }
};

const createProxy = (label: string): HTMLInputElement => {
  const proxy = document.createElement('input');
  proxy.type = 'text';
  proxy.dir = 'auto';
  proxy.maxLength = 300;
  proxy.autocomplete = 'off';
  proxy.spellcheck = false;
  proxy.setAttribute('autocapitalize', 'off');
  proxy.setAttribute('enterkeyhint', 'search');
  proxy.setAttribute('aria-label', label);
  proxy.dataset.searchKeystrokes = '';
  // Invisible but focusable; 16px keeps iOS from zooming when it takes focus.
  Object.assign(proxy.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    padding: '0',
    border: '0',
    opacity: '0',
    pointerEvents: 'none',
    fontSize: '16px',
  });
  document.body.append(proxy);
  return proxy;
};

function start(label: string, onCancel?: () => void): Capture {
  const proxy = createProxy(label);
  const onKeyDown = (event: KeyboardEvent) => {
    const current = capture;
    if (!current) return;
    if (event.key === 'Escape' && document.activeElement === current.proxy) {
      event.preventDefault();
      const cancel = current.onCancel;
      cancelSearchKeystrokes();
      cancel?.();
      return;
    }
    // A field has the keys already (the holder, or one the reader chose).
    if (isEditable(document.activeElement)) return;
    // Shortcuts are not text. AltGr arrives as Ctrl+Alt on Windows: that is typing.
    if (event.metaKey || (event.ctrlKey && !event.altKey)) return;
    if (event.key.length !== 1 && event.key !== 'Process' && event.key !== 'Unidentified') return;
    // Focus moved to the page between two fields: put the holder back under the
    // key before its character is inserted.
    focusField(current.holder.isConnected ? current.holder : current.proxy);
  };
  const onCompositionStart = (event: Event) => {
    if (capture && event.target === capture.holder) capture.composing = true;
  };
  const onCompositionEnd = (event: Event) => {
    if (capture && event.target === capture.holder) capture.composing = false;
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('compositionstart', onCompositionStart, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  return {
    proxy,
    holder: proxy,
    composing: false,
    onCancel,
    cleanup: () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('compositionstart', onCompositionStart, true);
      document.removeEventListener('compositionend', onCompositionEnd, true);
      proxy.remove();
    },
  };
}

/**
 * Starts keeping keystrokes. Call it synchronously from the event that opens
 * search (the shortcut's keydown, the trigger's click) so the hidden field has
 * focus before the next key arrives, and a phone raises its keyboard.
 */
export function beginSearchKeystrokes({ label = 'Search', onCancel }: { label?: string; onCancel?: () => void } = {}): void {
  if (typeof document === 'undefined') return;
  if (capture) {
    if (onCancel) capture.onCancel = onCancel;
  } else {
    capture = start(label, onCancel);
  }
  if (document.activeElement !== capture.holder) focusField(capture.holder);
}

/**
 * Lets a visible field (the loading shell's) hold the text: it receives what was
 * typed so far, with the caret at the end. Returns the cleanup that hands the
 * text, and focus, back to the hidden field when that field goes away.
 */
export function holdSearchKeystrokes(field: HTMLInputElement, label?: string): () => void {
  if (!capture) capture = start(label ?? field.getAttribute('aria-label') ?? 'Search');
  const current = capture;
  const hadFocus = document.activeElement === current.holder || document.activeElement === field || !isEditable(document.activeElement);
  if (current.holder !== field) field.value = current.holder.value;
  current.holder = field;
  if (hadFocus) focusField(field);
  return () => {
    if (capture !== current || current.holder !== field) return;
    const moveFocus = document.activeElement === field || !isEditable(document.activeElement);
    current.holder = current.proxy;
    // Leaving the field commits any open composition into it, so its text is
    // copied after focus moves.
    current.composing = false;
    // React detaches refs before it removes the node, so this runs while the
    // field still has focus: the hidden field takes over without a gap.
    if (moveFocus) current.proxy.focus({ preventScroll: true });
    current.proxy.value = field.value;
    if (moveFocus) focusField(current.proxy);
  };
}

/** Whether search is keeping keystrokes right now. */
export const searchKeystrokesActive = (): boolean => capture !== null;

/**
 * Ends the capture and returns everything typed, or `null` when nothing was
 * being kept. When the reader is mid-composition (an IME candidate is still
 * open), `onReady` runs once it is committed, so no half-composed text is cut.
 */
export function takeSearchKeystrokes(onReady: (typed: string | null) => void): () => void {
  const current = capture;
  if (!current) {
    onReady(null);
    return () => undefined;
  }
  const finish = () => {
    if (capture !== current) return;
    const typed = current.holder.value;
    capture = null;
    current.cleanup();
    onReady(typed);
  };
  if (!current.composing) {
    finish();
    return () => undefined;
  }
  // The composition's own input event lands right after compositionend.
  const onEnd = () => setTimeout(finish, 0);
  current.holder.addEventListener('compositionend', onEnd, { once: true });
  return () => current.holder.removeEventListener('compositionend', onEnd);
}

/** Drops the capture (search closed) without moving focus anywhere. */
export function cancelSearchKeystrokes(): void {
  const current = capture;
  if (!current) return;
  capture = null;
  current.cleanup();
}
