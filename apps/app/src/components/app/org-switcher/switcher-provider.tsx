import { Dialog, DialogContent, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { useT } from '@nibleaf/i18n/react';
import { useRouterState } from '@tanstack/react-router';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrganizationBySlug, useProject, useSwitcher } from '@/hooks/api';
import { CreateOrganizationDialog } from './create-organization-dialog';
import { SwitcherContext, type SwitcherControls, type SwitcherKind } from './switcher-context';
import { createSequenceHandler, type Pane } from './switcher-model';
import { SwitcherPanel } from './switcher-panel';

/** The org of the page in view, from the URL only (§5.4.2: no client-side "current org" state). */
function useCurrentScope() {
  const params = useRouterState({ select: (state) => (state.matches.at(-1)?.params ?? {}) as { orgSlug?: string; projectId?: string } });
  const bySlug = useOrganizationBySlug(params.orgSlug);
  const project = useProject(params.projectId);
  const switcher = useSwitcher();
  const organizationId =
    bySlug.data?.id ??
    project.data?.organizationId ??
    (params.orgSlug ? switcher.data?.organizations.find((org) => org.slug === params.orgSlug)?.id : undefined);
  return { organizationId, projectId: params.projectId, orgSlug: params.orgSlug };
}

/**
 * App-wide switcher state, mounted once next to the command palette. Owns the
 * `G` then `O` / `G` then `W` sequences, the create-organization dialog and a
 * centered fallback for the org switcher on screens without the header
 * trigger (Account settings).
 */
export function SwitcherProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [open, setOpen] = useState<SwitcherControls['open']>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [triggers, setTriggers] = useState({ organization: 0, website: 0 });
  const scope = useCurrentScope();
  const triggersRef = useRef(triggers);
  triggersRef.current = triggers;

  const openSwitcher = useCallback((kind: SwitcherKind, pane: Pane = 'orgs') => {
    // Without a website trigger (org pages, Account), "website" means the org switcher's websites pane.
    if (kind === 'website' && triggersRef.current.website === 0) setOpen({ kind: 'organization', pane: 'websites' });
    else setOpen({ kind, pane });
  }, []);
  const registerTrigger = useCallback((kind: SwitcherKind) => {
    setTriggers((count) => ({ ...count, [kind]: count[kind] + 1 }));
    return () => setTriggers((count) => ({ ...count, [kind]: count[kind] - 1 }));
  }, []);

  useEffect(() => {
    const handle = createSequenceHandler({ organization: () => openSwitcher('organization'), website: () => openSwitcher('website') });
    const onKeyDown = (event: KeyboardEvent) => {
      if (handle(event)) event.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openSwitcher]);

  const controls = useMemo<SwitcherControls>(
    () => ({
      open,
      openSwitcher,
      close: () => setOpen(null),
      openCreateOrganization: () => {
        setOpen(null);
        setCreateOpen(true);
      },
      registerTrigger,
      current: { organizationId: scope.organizationId, projectId: scope.projectId },
    }),
    [open, openSwitcher, registerTrigger, scope.organizationId, scope.projectId],
  );

  const fallback = open?.kind === 'organization' && triggers.organization === 0;
  return (
    <SwitcherContext.Provider value={controls}>
      {children}
      {fallback ? (
        <Dialog onOpenChange={(next) => !next && setOpen(null)} open>
          <DialogContent className="max-h-[min(440px,100dvh)] gap-0 overflow-hidden p-0 sm:max-w-[640px]" showCloseButton={false}>
            <DialogTitle className="sr-only">{t('switcher.dialogLabel')}</DialogTitle>
            <SwitcherPanel
              currentOrganizationId={scope.organizationId}
              currentProjectId={scope.projectId}
              initialPane={open.pane}
              onClose={() => setOpen(null)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
      <CreateOrganizationDialog onOpenChange={setCreateOpen} open={createOpen} />
    </SwitcherContext.Provider>
  );
}
