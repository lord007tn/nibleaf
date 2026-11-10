import { Button } from '@nibleaf/design-system/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { ChevronsUpDown } from 'lucide-react';
import { useEffect } from 'react';
import { OrgAvatar } from './org-avatar';
import { useSwitcherControls } from './switcher-context';
import { SwitcherPanel } from './switcher-panel';
import { useCompactSwitcher } from './use-compact-switcher';

/**
 * `[Org ▾]`: the first part of the shell breadcrumb (§5.4.1). A fixed-size
 * two-pane popover on desktop; a full-height drill-down sheet at ≤ 640 px.
 * Open state lives in the SwitcherProvider so the palette and `G` `O` can open it.
 */
export function OrganizationSwitcher({
  organization,
  currentProjectId,
  collapseName = false,
  className,
}: {
  /** Below 640 px show only the avatar (website level, where space is short). */
  collapseName?: boolean;
  organization: { id: string; name: string; logo: string | null } | undefined;
  currentProjectId?: string;
  className?: string;
}) {
  const t = useT();
  const controls = useSwitcherControls();
  const compact = useCompactSwitcher();
  const registerTrigger = controls?.registerTrigger;
  useEffect(() => registerTrigger?.('organization'), [registerTrigger]);
  const open = controls?.open?.kind === 'organization';
  const setOpen = (next: boolean) => (next ? controls?.openSwitcher('organization') : controls?.close());

  const trigger = (
    <Button
      aria-haspopup="dialog"
      aria-label={organization ? t('switcher.organizationTrigger', { org: organization.name }) : t('switcher.dialogLabel')}
      className={cn('h-8 min-w-0 max-w-56 gap-2 px-1.5 font-medium data-[popup-open]:bg-muted', className)}
      variant="ghost"
    >
      {organization ? (
        <>
          <OrgAvatar logo={organization.logo} name={organization.name} className="size-5" />
          <span className={cn('min-w-0 truncate', collapseName && 'hidden sm:inline')}>
            <bdi>{organization.name}</bdi>
          </span>
        </>
      ) : (
        <>
          <span className="sr-only">{t('common.loading')}</span>
          <Skeleton aria-hidden className="size-5 rounded-md" />
          <Skeleton aria-hidden className="h-4 w-20" />
        </>
      )}
      <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </Button>
  );
  const panel = (
    <SwitcherPanel
      currentOrganizationId={organization?.id}
      currentProjectId={currentProjectId}
      initialPane={controls?.open?.pane}
      onClose={() => setOpen(false)}
    />
  );

  if (compact) {
    return (
      <>
        {/* The sheet is not anchored, so the trigger is a plain button. */}
        <Button {...trigger.props} aria-expanded={open} onClick={() => setOpen(true)} />
        <Sheet onOpenChange={setOpen} open={open}>
          <SheetContent aria-label={t('switcher.dialogLabel')} className="h-dvh max-h-dvh gap-0 p-0" side="bottom">
            <SheetHeader className="border-border border-b py-3 pe-14">
              <SheetTitle>{t('switcher.dialogLabel')}</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1">{panel}</div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={trigger} />
      <PopoverContent
        align="start"
        aria-label={t('switcher.dialogLabel')}
        className="h-[min(440px,var(--available-height))] w-[640px] gap-0 overflow-hidden p-0"
        initialFocus={false}
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}
