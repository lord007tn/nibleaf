-- Built CONCURRENTLY so audit inserts, and the MCP requests that wait for
-- them, keep flowing while the index builds over a large audit history.
-- CONCURRENTLY cannot run inside a transaction; Prisma applies a migration
-- holding a single statement on its own, so keep this file to one statement.
-- If a build is interrupted, drop the INVALID index and run the migration again.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "mcp_audit_event_oauthGrantId_createdAt_idx" ON "mcp_audit_event"("oauthGrantId", "createdAt");
