import { createFileRoute } from '@tanstack/react-router';
import { AuthProviders } from '@/components/auth-providers';
import { McpOAuthConsentStep } from '@/components/oauth/mcp-oauth-steps';
import { QueryProvider } from '@/integrations/tanstack-query/root-provider';

/** Better Auth's MCP consent page: approve or deny the connection. */
export const Route = createFileRoute('/oauth/consent')({
  head: () => ({ meta: [{ title: 'Allow access — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: () => (
    <QueryProvider>
      <AuthProviders>
        <McpOAuthConsentStep />
      </AuthProviders>
    </QueryProvider>
  ),
});
