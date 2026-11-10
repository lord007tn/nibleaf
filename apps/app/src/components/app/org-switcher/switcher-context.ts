import { createContext, useContext } from 'react';
import type { Pane } from './switcher-model';

export type SwitcherKind = 'organization' | 'website';

export interface SwitcherControls {
  /** Which switcher is open; `pane` is where keyboard focus starts in the org switcher. */
  open: { kind: SwitcherKind; pane: Pane } | null;
  openSwitcher: (kind: SwitcherKind, pane?: Pane) => void;
  close: () => void;
  openCreateOrganization: () => void;
  /** Header triggers register so the provider knows whether to anchor or fall back to a dialog. */
  registerTrigger: (kind: SwitcherKind) => () => void;
  current: { organizationId?: string; projectId?: string };
}

export const SwitcherContext = createContext<SwitcherControls | null>(null);

export const useSwitcherControls = () => useContext(SwitcherContext);
