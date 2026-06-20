import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Project } from '@/hooks/api';
import { useAddDomain, useDeleteDomain, useDomains, useVerifyDomain } from '@/hooks/api';
import { cn } from '@/lib/utils';
import { SectionHeader } from './shared';

export function DomainSection({ project }: { project: Project }) {
  const { data: domains } = useDomains(project.id);
  const add = useAddDomain(project.id);
  const verify = useVerifyDomain(project.id);
  const remove = useDeleteDomain(project.id);
  const [domain, setDomain] = useState('');

  const list = domains ?? [];

  return (
    <div>
      <SectionHeader icon="◷" title="Custom domain" />
      <p className="mb-4 text-[13.5px] text-muted-foreground leading-relaxed">
        Point your own domain at this docs site. SSL is issued and renewed automatically.
      </p>

      <form
        className="flex gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!domain.trim()) {
            return;
          }
          add.mutate(
            { domain: domain.trim() },
            {
              onSuccess: () => {
                toast.success('Domain added');
                setDomain('');
              },
              onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not add the domain'),
            },
          );
        }}
      >
        <Input
          className="h-[42px] flex-1 rounded-[10px] font-mono text-sm"
          onChange={(e) => setDomain(e.target.value)}
          placeholder="docs.yoursite.com"
          value={domain}
        />
        <Button className="h-[42px] cursor-pointer rounded-[10px]" disabled={add.isPending} type="submit">
          Add domain
        </Button>
      </form>

      <div className="mt-4 space-y-3">
        {list.map((d) => (
          <div className="rounded-xl border border-border p-3.5" key={d.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="font-medium font-mono text-sm">{d.domain}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold text-[12px]',
                    d.verified ? 'bg-primary/10 text-primary' : 'bg-amber-500/10 text-amber-600',
                  )}
                >
                  <span className={cn('size-1.5 rounded-full', d.verified ? 'bg-primary' : 'bg-amber-500')} />
                  {d.verified ? 'Live' : 'Pending verification'}
                </span>
              </div>
              <div className="flex gap-1.5">
                {!d.verified ? (
                  <Button
                    className="cursor-pointer"
                    onClick={() => verify.mutate(d.id, { onSuccess: () => toast.success('Verified') })}
                    size="sm"
                    variant="outline"
                  >
                    Verify DNS
                  </Button>
                ) : null}
                <Button className="cursor-pointer" onClick={() => remove.mutate(d.id)} size="sm" variant="ghost">
                  Remove
                </Button>
              </div>
            </div>

            {!d.verified && d.records?.length ? (
              <div className="mt-4">
                <div className="mb-2.5 font-semibold text-[12px] text-muted-foreground uppercase tracking-wide">
                  Add this DNS record at your provider
                </div>
                <div className="overflow-hidden rounded-xl border border-border font-mono text-[12.5px]">
                  <div className="grid grid-cols-[80px_1fr_1.4fr] border-border border-b bg-muted/40 px-3.5 py-2.5 text-muted-foreground">
                    <span>Type</span>
                    <span>Name</span>
                    <span>Value</span>
                  </div>
                  {d.records.map((record) => (
                    <div className="grid grid-cols-[80px_1fr_1.4fr] items-center px-3.5 py-2.5" key={record.type + record.name}>
                      <span className="font-semibold">{record.type}</span>
                      <span className="truncate">{record.name}</span>
                      <span className="truncate text-primary">{record.value}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[13px] text-muted-foreground">DNS can take a few minutes to propagate.</p>
              </div>
            ) : null}
          </div>
        ))}
        {list.length === 0 ? <p className="text-muted-foreground text-sm">No custom domains yet.</p> : null}
      </div>
    </div>
  );
}
