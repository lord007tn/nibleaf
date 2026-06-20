import { CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useWorkspaceSettings } from '@/hooks/api';
import { SettingsSection } from './section';

function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-muted-foreground text-sm">{label}</span>
        <span className="font-medium text-sm tabular-nums">
          {used.toLocaleString()} / {limit.toLocaleString()}
        </span>
      </div>
      <Progress value={pct} />
    </div>
  );
}

export function BillingTab() {
  const { data } = useWorkspaceSettings();
  const plan = data?.plan ?? 'Free';
  const projectCount = data?.projectCount ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Plan" action={<Badge variant="secondary">Current</Badge>}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="leading-snug">
            <div className="font-semibold text-lg">{plan} plan</div>
            <p className="mt-1 text-muted-foreground text-sm">Renews — · billed monthly</p>
          </div>
        </div>
        <div className="flex flex-col gap-4">
          <UsageMeter label="Projects" limit={Math.max(10, projectCount)} used={projectCount} />
          <UsageMeter label="Pageviews" limit={100_000} used={12_480} />
          <UsageMeter label="Custom domains" limit={5} used={1} />
        </div>
        <div className="mt-5 flex gap-2 border-border border-t pt-5">
          <Button onClick={() => toast.info('Billing portal coming soon')}>Upgrade plan</Button>
          <Button variant="outline" onClick={() => toast.info('Billing portal coming soon')}>
            Cancel subscription
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Payment method">
        <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/40 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
            <CreditCard className="size-5" />
          </span>
          <div className="flex-1 leading-snug">
            <div className="font-medium text-sm">No card on file</div>
            <p className="mt-0.5 text-muted-foreground text-sm">Add a payment method to upgrade to a paid plan.</p>
          </div>
          <Button variant="outline" onClick={() => toast.info('Billing portal coming soon')}>
            Add payment method
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Billing history">
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="grid grid-cols-[1.4fr_1fr_1fr_auto] border-border border-b bg-muted/50 px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            <span>Invoice</span>
            <span>Date</span>
            <span>Amount</span>
            <span />
          </div>
          <p className="px-4 py-8 text-center text-muted-foreground text-sm">No invoices yet</p>
        </div>
      </SettingsSection>
    </div>
  );
}
