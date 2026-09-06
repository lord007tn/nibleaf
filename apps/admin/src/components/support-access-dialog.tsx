import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useT } from '@nibleaf/i18n/react';
import { Eye, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useStartSupportAccess } from '@/hooks/api/mutations';

export type SupportAccessTarget = {
  userId: string;
  label: string;
  detail: string;
  organizationId: string;
};

export function SupportAccessDialog({ targets, subject }: { targets: SupportAccessTarget[]; subject: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(targets[0]?.organizationId ? `${targets[0].userId}:${targets[0].organizationId}` : '');
  const start = useStartSupportAccess();

  useEffect(() => {
    if (!targets.some((target) => `${target.userId}:${target.organizationId}` === selected)) {
      setSelected(targets[0] ? `${targets[0].userId}:${targets[0].organizationId}` : '');
    }
  }, [selected, targets]);

  const target = targets.find((item) => `${item.userId}:${item.organizationId}` === selected);
  // One array feeds both the trigger label (`items`) and the rendered options so they can't drift.
  const targetOptions = targets.map((item) => ({
    value: `${item.userId}:${item.organizationId}`,
    label: (
      <span dir="auto">
        {item.label} — {item.detail}
      </span>
    ),
  }));

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Button disabled={targets.length === 0} onClick={() => setOpen(true)} title={targets.length ? undefined : t('admin.support.noEligible')}>
        <Eye className="size-4" /> {t('admin.support.action')}
      </Button>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.support.title', { subject })}</DialogTitle>
          <DialogDescription>{t('admin.support.description')}</DialogDescription>
        </DialogHeader>

        {targets.length > 1 ? (
          <div className="grid gap-2 text-sm">
            <Label htmlFor="support-access-target">{t('admin.support.target')}</Label>
            <Select items={targetOptions} onValueChange={(value) => setSelected(value ?? '')} value={selected}>
              <SelectTrigger className="w-full" id="support-access-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targetOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : target ? (
          <div className="rounded-lg border p-3 text-sm">
            <p className="font-medium">{target.label}</p>
            <p className="text-muted-foreground text-xs">{target.detail}</p>
          </div>
        ) : null}

        <Alert>
          <ShieldAlert />
          <AlertTitle>{t('admin.support.cautionTitle')}</AlertTitle>
          <AlertDescription>{t('admin.support.cautionBody')}</AlertDescription>
        </Alert>

        <DialogFooter>
          <Button disabled={start.isPending} onClick={() => setOpen(false)} variant="outline">
            {t('common.cancel')}
          </Button>
          <Button
            disabled={!target || start.isPending}
            onClick={() => target && start.mutate({ userId: target.userId, organizationId: target.organizationId })}
          >
            {start.isPending ? t('admin.support.starting') : t('admin.support.start')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
