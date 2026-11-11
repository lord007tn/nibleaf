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
 *
 * A field that is composing (an IME candidate window is open) is never left
 * mid-composition: moving focus or removing the field would cut or drop the
 * pre-edit text. Every hand-over waits until the composition has ended and its
 * final `input` event has landed, then moves the committed text and focus.
 */

type Capture = {
  /** Hidden field that receives keys while no visible field is on screen. */
  proxy: HTMLInputElement;
  /** The field currently holding the text: the proxy, the loading shell's field. */
  holder: HTMLInputElement;
  /** The reader typed, deleted or pasted something (even if the text is empty now). */
  edited: boolean;
  /** An IME composition is open in the holder. */
  composing: boolean;
  /** The composition ended; its final `input` event may still be on its way. */
  settling: boolean;
  /** Hand-overs waiting for the composition to settle, in request order. */
  waiters: Array<() => void>;
  onCancel?: () => void;
  cleanup: () => void;
};

/** What the reader typed while search opened. */
export interface SearchKeystrokes {
  text: string;
  /** False when the reader typed nothing at all (a reopened dialog keeps its query). */
  edited: boolean;
}

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
  // It sits where the search field opens, so an IME candidate window appears there.
  Object.assign(proxy.style, {
    position: 'fixed',
    top: '12vh',
    left: '50%',
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

const isSettled = (current: Capture) => !current.composing && !current.settling;

function settle(current: Capture) {
  if (!current.settling || current.composing) return;
  current.settling = false;
  const waiters = current.waiters.splice(0);
  for (const waiter of waiters) waiter();
}

/** Runs `callback` now, or once the holder's composition has settled. */
function whenSettled(current: Capture, callback: () => void): () => void {
  if (isSettled(current)) {
    callback();
    return () => undefined;
  }
  current.waiters.push(callback);
  return () => {
    const index = current.waiters.indexOf(callback);
    if (index !== -1) current.waiters.splice(index, 1);
  };
}

function start(label: string, onCancel?: () => void): Capture {
  const proxy = createProxy(label);
  const current: Capture = {
    proxy,
    holder: proxy,
    edited: false,
    composing: false,
    settling: false,
    waiters: [],
    onCancel,
    cleanup: () => undefined,
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (capture !== current) return;
    if (event.isComposing) return;
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
    if (event.key.length !== 1 && event.key !== 'Process' && event.key !== 'Unidentified' && event.key !== 'Backspace') return;
    // Focus moved to the page between two fields: put the holder back under the
    // key before its character is inserted.
    focusField(current.holder.isConnected ? current.holder : current.proxy);
  };
  const onCompositionStart = (event: Event) => {
    if (event.target !== current.holder) return;
    current.composing = true;
    current.settling = false;
  };
  const onCompositionEnd = (event: Event) => {
    if (event.target !== current.holder) return;
    current.composing = false;
    current.settling = true;
    // Chrome sends the final `input` before `compositionend`, Firefox and Safari
    // right after it in the same task: a macrotask later it has landed either way.
    setTimeout(() => settle(current), 0);
  };
  const onInput = (event: Event) => {
    if (event.target !== current.holder) return;
    current.edited = true;
    if (current.settling && !(event as InputEvent).isComposing) queueMicrotask(() => settle(current));
  };
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('compositionstart', onCompositionStart, true);
  document.addEventListener('compositionend', onCompositionEnd, true);
  document.addEventListener('input', onInput, true);
  current.cleanup = () => {
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('compositionstart', onCompositionStart, true);
    document.removeEventListener('compositionend', onCompositionEnd, true);
    document.removeEventListener('input', onInput, true);
    current.waiters.length = 0;
    proxy.remove();
  };
  return current;
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
 * Lets a visible field (the loading shell's) hold the text: once the hidden
 * field has no open composition, it receives what was typed so far, focus, and
 * the caret at the end. Returns the cleanup for when that field goes away.
 */
export function holdSearchKeystrokes(field: HTMLInputElement, label?: string): () => void {
  if (!capture) capture = start(label ?? field.getAttribute('aria-label') ?? 'Search');
  const current = capture;
  const adopt = () => {
    if (capture !== current || !field.isConnected || current.holder === field) return;
    const moveFocus = document.activeElement === current.holder || document.activeElement === field || !isEditable(document.activeElement);
    field.value = current.holder.value;
    current.holder = field;
    if (moveFocus) focusField(field);
  };
  const cancelAdopt = whenSettled(current, adopt);
  return () => {
    cancelAdopt();
    if (capture !== current || current.holder !== field) return;
    // The field is leaving (search closed while it held the text). React detaches
    // refs before it removes the node, so the hidden field takes over without a gap.
    const moveFocus = document.activeElement === field || !isEditable(document.activeElement);
    current.holder = current.proxy;
    current.composing = false;
    current.settling = false;
    current.proxy.value = field.value;
    if (moveFocus) focusField(current.proxy);
    // Its composition ended with it. A dialog closing in the same commit has
    // cancelled its own wait by the time this runs.
    queueMicrotask(() => {
      if (capture !== current || !isSettled(current)) return;
      const waiters = current.waiters.splice(0);
      for (const waiter of waiters) waiter();
    });
  };
}

/**
 * Ends the capture and hands over everything typed (`null` when nothing was
 * being kept). While the holder is composing, `onReady` waits until that
 * composition has ended and its final input landed, so no pre-edit text is cut.
 * Returns a cancel for that wait.
 */
export function takeSearchKeystrokes(onReady: (typed: SearchKeystrokes | null) => void): () => void {
  const current = capture;
  if (!current) {
    onReady(null);
    return () => undefined;
  }
  return whenSettled(current, () => {
    if (capture !== current) return;
    const text = current.holder.value;
    const edited = current.edited || text !== '';
    capture = null;
    current.cleanup();
    onReady({ text, edited });
  });
}

/** Drops the capture (search closed) without moving focus anywhere. */
export function cancelSearchKeystrokes(): void {
  const current = capture;
  if (!current) return;
  capture = null;
  current.cleanup();
}
