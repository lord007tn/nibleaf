import { Menu } from 'lucide-react';
import type { ComponentProps } from 'react';
import type { NavNode } from '@/hooks/api';
import { intentModule, useIntentModule } from '@/lib/intent-module';

interface MobileNavLink {
  label: string;
  href: string;
  active: boolean;
  external: boolean;
}

/** A reader setting (language, version) that the header hides on phones. */
export interface MobileNavChoice {
  id: string;
  /** Visible section label, e.g. "Language". */
  label: string;
  value: string;
  options: Array<{ value: string; label: string; lang?: string; dir?: 'ltr' | 'rtl' }>;
  onChange: (value: string) => void;
}

export interface MobileNavProps {
  nodes: NavNode[];
  projectId: string;
  currentPath: string;
  lang?: string;
  version?: string;
  /** Drawer title, e.g. "Menu". */
  label: string;
  /** Accessible name of the hamburger button; defaults to `label`. */
  triggerLabel?: string;
  /** Accessible name of the page tree inside the drawer. */
  navLabel?: string;
  closeLabel?: string;
  toggleLabel: string;
  isRtl?: boolean;
  links?: MobileNavLink[];
  anchors?: MobileNavLink[];
  cta?: { label: string; href: string };
  choices?: MobileNavChoice[];
}

/** The drawer (a Base UI dialog with a scroll area) loads when a reader
 *  reaches for the menu button (see lib/intent-module.ts). */
const drawerModule = intentModule(() => import('./mobile-nav-drawer'));

/** The menu button's markup, shared by the static button and the drawer's own trigger. */
export const mobileNavTriggerProps = (label: string, triggerLabel?: string): ComponentProps<'button'> => ({
  type: 'button',
  'aria-label': triggerLabel ?? label,
  className:
    '-ms-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden',
  children: <Menu className="size-5" aria-hidden />,
});

/**
 * Hamburger + slide-in drawer that exposes the full page tree below `lg`, where
 * the desktop sidebar is hidden. Without it, multi-page sites are unnavigable on
 * phones (only search + the prev/next pager survive). The header's section links
 * (Docs/Changelog/custom) are mirrored at the top since they're hidden below `lg`.
 * On phones the header keeps a single row, so the language and version
 * switchers move in here as labelled settings.
 */
export function MobileNav(props: MobileNavProps) {
  const { loaded, start, trigger } = useIntentModule(drawerModule);
  if (loaded) return <loaded.MobileNavDrawer {...props} start={start} />;
  return (
    <button
      {...mobileNavTriggerProps(props.label, props.triggerLabel)}
      data-slot="sheet-trigger"
      aria-haspopup="dialog"
      aria-expanded={false}
      {...trigger}
    />
  );
}
