export const MCP_SCOPES = [
  'mcp:connect',
  'projects:read',
  'pages:read',
  'languages:read',
  'versions:read',
  'analytics:read',
  'themes:read',
  'exports:read',
  'deployments:read',
  'integrations:read',
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];
