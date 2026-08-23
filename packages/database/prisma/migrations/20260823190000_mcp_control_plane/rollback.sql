-- Run only after the application has been rolled back to a version that does
-- not read MCP audit data or the MCP-owned API-key provenance columns.
--
-- ApiKey.expiresAt is intentionally preserved. The integrations migration owns
-- that shared lifecycle field in the final migration chain, and rolling MCP
-- back must not remove a column still used by integration credentials.
--
-- Wildcard normalization is also intentionally not reversed. Reintroducing '*'
-- could grant capabilities to a legacy key. Unknown legacy scopes and the
-- conservative read scopes added during migration remain inert without
-- mcp:connect and can be reviewed or rotated by an administrator.

ALTER TABLE "mcp_audit_event"
  DROP CONSTRAINT IF EXISTS "mcp_audit_event_projectId_fkey";
DROP INDEX IF EXISTS "mcp_audit_event_requestId_idx";
DROP INDEX IF EXISTS "mcp_audit_event_apiKeyId_createdAt_idx";
DROP INDEX IF EXISTS "mcp_audit_event_projectId_createdAt_idx";
DROP TABLE IF EXISTS "mcp_audit_event";

ALTER TABLE "api_key"
  DROP CONSTRAINT IF EXISTS "api_key_createdById_fkey";
DROP INDEX IF EXISTS "api_key_rotatedFromId_idx";
DROP INDEX IF EXISTS "api_key_createdById_idx";
ALTER TABLE "api_key"
  DROP COLUMN IF EXISTS "rotatedFromId",
  DROP COLUMN IF EXISTS "createdById";
