import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, FileText, MailCheck, Rocket, ShieldCheck, UserPlus, Users } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useAdminOverview } from '@/hooks/api/queries';

export const Route = createFileRoute('/(dashboard)/')({
  component: OverviewPage,
});

function OverviewPage() {
  const { data, isPending } = useAdminOverview();
  const stats: { label: string; value: number | undefined; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
    { label: 'Customers', value: data?.users, icon: Users },
    { label: 'Verified emails', value: data?.verifiedUsers, icon: MailCheck },
    { label: 'Admins', value: data?.admins, icon: ShieldCheck },
    { label: 'Sites', value: data?.sites, icon: FileText },
    { label: 'Total deployments', value: data?.deployments, icon: Rocket },
    { label: 'Published', value: data?.publishedDeployments, icon: CheckCircle2 },
    { label: 'New customers (7d)', value: data?.recentUsers, icon: UserPlus },
  ];
  return (
    <div className="mx-auto max-w-5xl px-8 py-8">
      <h1 className="font-semibold text-2xl tracking-tight">Overview</h1>
      <p className="mt-1 text-muted-foreground text-sm">Customer, site, and deployment health for Nibleaf Cloud.</p>
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">{stat.label}</span>
              <stat.icon className="size-4 text-muted-foreground" />
            </div>
            <div className="mt-2 font-semibold text-3xl tracking-tight">{isPending ? '—' : (stat.value ?? 0)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
