import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { GradientAvatar } from '@/components/settings/section';
import { Button } from '@/components/ui/button';
import { useMembers } from '@/hooks/api';
import { SectionHeader } from './shared';

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Editor' };

export function MembersSection() {
  const { data } = useMembers();
  const members = data?.members ?? [];

  return (
    <div>
      <SectionHeader icon="⧉" title="Members" />

      <div className="mb-3 flex items-center">
        <span className="font-mono text-[12px] text-muted-foreground">
          {members.length} {members.length === 1 ? 'member' : 'members'}
        </span>
        <Button className="ms-auto h-[34px] cursor-pointer rounded-[9px]" render={<Link to="/app/members" />} size="sm">
          <Plus className="size-3.5" /> Invite
        </Button>
      </div>

      {members.map((member) => (
        <div className="flex items-center gap-3 border-border border-t py-3" key={member.id}>
          <GradientAvatar className="size-8 text-[12px]" name={member.user.name} />
          <div className="leading-tight">
            <div className="font-medium text-[13.5px]">{member.user.name}</div>
            <div className="text-[12px] text-muted-foreground">{member.user.email}</div>
          </div>
          <span className="ms-auto rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground">
            {ROLE_LABELS[member.role] ?? member.role}
          </span>
        </div>
      ))}
      {members.length === 0 ? <p className="border-border border-t py-3 text-muted-foreground text-sm">No members yet.</p> : null}
    </div>
  );
}
