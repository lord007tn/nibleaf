import { NibleafMark, NibleafWordmark } from '@nibleaf/design-system/brand';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@nibleaf/design-system/components/ui/sidebar';
import { Link, useRouterState } from '@tanstack/react-router';
import { Activity, LayoutDashboard, LogOut, Server, Users } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { signOut, useSession } from '@/services/auth-client';

const NAV: { to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>>; exact: boolean }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, exact: true },
  { to: '/users', label: 'Customers', icon: Users, exact: false },
  { to: '/sites', label: 'Sites', icon: Server, exact: false },
  { to: '/operations', label: 'Operations', icon: Activity, exact: false },
];

export function AdminSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: session } = useSession();
  const user = session?.user;
  const initial = (user?.name ?? user?.email ?? 'A').slice(0, 1).toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <NibleafMark className="size-7" />
          <NibleafWordmark className="font-semibold tracking-tight" />
          <span className="ms-auto rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Admin</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Platform</SidebarGroupLabel>
          <SidebarMenu>
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton isActive={active} render={<Link to={item.to} />} tooltip={item.label}>
                    <item.icon className="size-4" />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted font-medium text-muted-foreground text-xs">
                {initial}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-xs">{user?.name ?? 'Admin'}</p>
                <p className="truncate text-[11px] text-muted-foreground">{user?.email ?? ''}</p>
              </div>
            </div>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => void signOut().then(() => window.location.assign('/sign-in'))} tooltip="Sign out">
              <LogOut className="size-4" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
