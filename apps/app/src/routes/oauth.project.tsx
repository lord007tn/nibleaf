import { createFileRoute } from '@tanstack/react-router';
import { AuthProviders } from '@/components/auth-providers';
import { McpOAuthProjectStep } from '@/components/oauth/mcp-oauth-steps';

/** Better Auth's MCP `postLogin` page: bind the connection to one project and
 *  a permission preset. The URL carries a live, signed authorization request. */
export const Route = createFileRoute('/oauth/project')({
  head: () => ({ meta: [{ title: 'Connect an AI app — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: () => (
    <AuthProviders>
      <McpOAuthProjectStep />
    </AuthProviders>
  ),
});
