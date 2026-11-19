import { createFileRoute } from '@tanstack/react-router';
import { AuthProviders } from '@/components/auth-providers';
import { McpOAuthProjectStep } from '@/components/oauth/mcp-oauth-steps';
import { loadRouteDashboardLocale } from '@/lib/dashboard-locale-route';

/** Better Auth's MCP `postLogin` page: bind the connection to one project and
 *  a permission preset. The URL carries a live, signed authorization request. */
export const Route = createFileRoute('/oauth/project')({
  // <html lang dir> follows the interface language (lib/root-document.ts).
  staticData: { interfaceLocale: true, dashboardLocale: true },
  loader: async ({ preload }) => {
    await loadRouteDashboardLocale(preload);
  },
  head: () => ({ meta: [{ title: 'Connect an AI app — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: () => (
    <AuthProviders>
      <McpOAuthProjectStep />
    </AuthProviders>
  ),
});
