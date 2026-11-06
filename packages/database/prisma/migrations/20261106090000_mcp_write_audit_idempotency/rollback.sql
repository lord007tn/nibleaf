-- Run only after the application has been rolled back to a version that does
-- not write MCP actor/target audit columns or use the MCP idempotency cache.
-- Dropping the cache only forgets replay results; dropping the audit columns
-- discards actor and target attribution recorded for MCP operations.

ALTER TABLE "mcp_idempotency_record"
  DROP CONSTRAINT IF EXISTS "mcp_idempotency_record_projectId_fkey";
DROP INDEX IF EXISTS "mcp_idempotency_record_projectId_expiresAt_idx";
DROP INDEX IF EXISTS "mcp_idempotency_record_apiKeyId_operation_clientRequestId_key";
DROP TABLE IF EXISTS "mcp_idempotency_record";

DROP INDEX IF EXISTS "mcp_audit_event_actorUserId_createdAt_idx";
ALTER TABLE "mcp_audit_event"
  DROP COLUMN IF EXISTS "clientRequestId",
  DROP COLUMN IF EXISTS "targetId",
  DROP COLUMN IF EXISTS "targetType",
  DROP COLUMN IF EXISTS "actorUserId";
