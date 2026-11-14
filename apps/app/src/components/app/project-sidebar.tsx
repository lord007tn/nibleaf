import { useDirection } from '@nibleaf/design-system/components/ui/direction';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@nibleaf/design-system/components/ui/sidebar';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { Link, useRouterState } from '@tanstack/react-router';
import { BarChart3, Bot, Eye, History, LayoutDashboard, type LucideIcon, PenLine, Settings as SettingsIcon } from 'lucide-react';
import { SidebarAccountFooter } from '@/components/app/sidebar-account-footer';
import { SidebarBrand } from '@/components/app/sidebar-brand';
import { sitePreviewLink } from '@/features/site-preview/components/site-preview-link';

type NavItem = { labelKey: MessageKey; to: string; icon: LucideIcon; isActive: boolean };

/**
 * Per-site sidebar: brand, the site's sections, and the account footer. The
 * switcher lives in the header. On phones the header has no room for Preview,
 * so the sheet carries it, after the sections.
 */
export function ProjectSidebar({ projectId, orgSlug, previewDraft = false }: { projectId: string; orgSlug?: string; previewDraft?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLocale();
  const direction = useDirection();
  const { setOpenMobile, isMobile } = useSidebar();
  const previewLink = sitePreviewLink(projectId, previewDraft, t);

  const base = `/app/projects/${projectId}`;
  const nav: NavItem[] = [
    { labelKey: 'project.overview', to: '/app/projects/$projectId', icon: LayoutDashboard, isActive: pathname === base },
    { labelKey: 'project.editor', to: '/app/projects/$projectId/editor', icon: PenLine, isActive: pathname.startsWith(`${base}/editor`) },
    { labelKey: 'publishes.title', to: '/app/projects/$projectId/publishes', icon: History, isActive: pathname.startsWith(`${base}/publishes`) },
    { labelKey: 'project.analytics', to: '/app/projects/$projectId/analytics', icon: BarChart3, isActive: pathname.startsWith(`${base}/analytics`) },
    { labelKey: 'dashboard.ai.title', to: '/app/projects/$projectId/ai', icon: Bot, isActive: pathname.startsWith(`${base}/ai`) },
    { labelKey: 'project.settings', to: '/app/projects/$projectId/settings', icon: SettingsIcon, isActive: pathname.startsWith(`${base}/settings`) },
  ];

  return (
    <Sidebar
      mobileTitle={t('nav.sidebarTitle')}
      mobileDescription={t('nav.sidebarDescription')}
      side={direction === 'rtl' ? 'right' : 'left'}
      variant="inset"
    >
      <SidebarHeader>
        <SidebarBrand orgSlug={orgSlug} />
      </SidebarHeader>

      <SidebarContent>
        {/* The sidebar's links are the site's main navigation landmark. */}
        <nav aria-label={t('nav.main')} className="contents">
          <SidebarGroup>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.labelKey}>
                  <SidebarMenuButton
                    onClick={() => setOpenMobile(false)}
                    isActive={item.isActive}
                    render={<Link params={{ projectId }} to={item.to} />}
                    size="lg"
                    tooltip={t(item.labelKey)}
                  >
                    <item.icon className="size-5" />
                    <span>{t(item.labelKey)}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {isMobile ? (
                <SidebarMenuItem className="sm:hidden">
                  <SidebarMenuButton onClick={() => setOpenMobile(false)} render={previewLink} size="lg">
                    <Eye className="size-5" />
                    <span>{t('project.preview')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : null}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>

      <SidebarAccountFooter />
    </Sidebar>
  );
}
