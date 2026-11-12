import { createFileRoute } from '@tanstack/react-router';
import { AuthProviders } from '@/components/auth-providers';
import { McpOAuthConsentStep } from '@/components/oauth/mcp-oauth-steps';

/** Better Auth's MCP consent page: approve or deny the connection. */
export const Route = createFileRoute('/oauth/consent')({
  // <html lang dir> follows the interface language (lib/root-document.ts).
  staticData: { interfaceLocale: true },
  head: () => ({ meta: [{ title: 'Allow access — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: () => (
    <AuthProviders>
      <McpOAuthConsentStep />
    </AuthProviders>
  ),
});
