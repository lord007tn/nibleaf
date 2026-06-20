import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { BarChart3, BookText, ChevronsUpDown, LogOut, Moon, Settings, Sun, Users } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useDirection } from '@/components/direction-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
} from '@/components/ui/sidebar';
import { useActiveWorkspace } from '@/hooks/use-active-workspace';
import { authClient } from '@/lib/auth-client';

const NAV = [
  { to: '/app', label: 'Projects', icon: BookText, exact: true },
  { to: '/app/analytics', label: 'Analytics', icon: BarChart3, exact: false },
  { to: '/app/members', label: 'Members', icon: Users, exact: false },
  { to: '/app/settings', label: 'Settings', icon: Settings, exact: false },
] as const;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const workspace = useActiveWorkspace();
  const { data: session } = authClient.useSession();
  const { setTheme, resolvedTheme } = useTheme();
  const { direction, toggleDirection } = useDirection();
  const navigate = useNavigate();

  const initials = (session?.user?.name ?? 'U')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <span className="grid size-7 place-items-center rounded-lg bg-foreground text-background">✎</span>
          <span className="font-semibold tracking-tight">Plume</span>
          <span className="ms-auto rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">OSS</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton isActive={active} tooltip={item.label} render={<Link to={item.to} />}>
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
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                    <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/60 font-semibold text-primary-foreground text-xs">
                      {initials}
                    </span>
                    <div className="grid flex-1 text-start leading-tight">
                      <span className="truncate font-medium text-sm">{workspace?.name ?? 'Workspace'}</span>
                      <span className="truncate text-muted-foreground text-xs">{session?.user?.email ?? ''}</span>
                    </div>
                    <ChevronsUpDown className="ms-auto size-4 text-muted-foreground" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent align="end" className="w-56" side="top">
                <DropdownMenuLabel>{session?.user?.name ?? 'Account'}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
                  {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                  {resolvedTheme === 'dark' ? 'Light mode' : 'Dark mode'}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={toggleDirection}>
                  <span className="grid size-4 place-items-center font-mono text-xs">{direction === 'rtl' ? '⇤' : '⇥'}</span>
                  {direction === 'rtl' ? 'Left-to-right' : 'Right-to-left'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={async () => {
                    await authClient.signOut();
                    navigate({ to: '/sign-in' });
                  }}
                >
                  <LogOut className="size-4" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
