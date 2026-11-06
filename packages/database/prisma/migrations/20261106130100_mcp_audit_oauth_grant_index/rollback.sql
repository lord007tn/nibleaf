-- Run before 20261106120000_mcp_oauth/rollback.sql. Dropping the index only
-- slows the connected-apps activity lookup; no data is lost.
DROP INDEX CONCURRENTLY IF EXISTS "mcp_audit_event_oauthGrantId_createdAt_idx";
