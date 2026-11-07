import { type CSSProperties, createContext, type ReactNode, useContext } from 'react';
import { AuthoredIcon, isDrawableIcon } from './authored-icon';
import { optionalNumber } from './utils';

// ─── Steps ──────────────────────────────────────────────────────────────────

type TitleSize = 'p' | 'h2' | 'h3' | 'h4';
const TITLE_SIZES = new Set<string>(['p', 'h2', 'h3', 'h4']);
const titleSizeOf = (value: unknown): TitleSize | undefined =>
  typeof value === 'string' && TITLE_SIZES.has(value) ? (value as TitleSize) : undefined;

/** The `titleSize` set on `<Steps>`, which each step uses unless it sets its own. */
const StepsTitleSize = createContext<TitleSize>('p');

export function Steps({ titleSize, children }: { titleSize?: unknown; children?: ReactNode }) {
  return (
    <StepsTitleSize.Provider value={titleSizeOf(titleSize) ?? 'p'}>
      {/* biome-ignore lint/a11y/noRedundantRoles: preserves list semantics in Safari when list-style is none. */}
      <ol className="reader-steps my-5 flex list-none flex-col gap-6 border-border border-s ps-6" role="list">
        {children}
      </ol>
    </StepsTitleSize.Provider>
  );
}

const TITLE_CLASSES: Record<TitleSize, string> = {
  p: 'mb-1 font-semibold',
  h2: 'mt-0 mb-2 font-semibold text-xl',
  h3: 'mt-0 mb-1.5 font-semibold text-lg',
  h4: 'mt-0 mb-1 font-semibold text-base',
};

export function Step({
  title,
  icon,
  stepNumber,
  titleSize,
  children,
}: {
  title?: string;
  /** Shown in the step's marker instead of its number. */
  icon?: string;
  /** Restarts the numbering at this step. */
  stepNumber?: unknown;
  titleSize?: unknown;
  children?: ReactNode;
}) {
  const inherited = useContext(StepsTitleSize);
  const size = titleSizeOf(titleSize) ?? inherited;
  const number = optionalNumber(stepNumber);
  const value = number === undefined ? undefined : Math.trunc(number);
  const hasIcon = isDrawableIcon(icon);
  const Title = size === 'p' ? 'div' : size;
  return (
    <li
      className="relative [&>:first-child]:mt-0 [&>:last-child]:mb-0"
      // `value` keeps the list semantics in step with the visible number.
      value={value}
      style={value === undefined ? undefined : ({ counterSet: `reader-step ${value}` } as CSSProperties)}
      data-step-icon={hasIcon ? '' : undefined}
    >
      {hasIcon ? (
        <span className="reader-step-marker" aria-hidden>
          <AuthoredIcon icon={icon} className="size-3.5" />
        </span>
      ) : null}
      {title ? <Title className={TITLE_CLASSES[size]}>{title}</Title> : null}
      {children}
    </li>
  );
}
