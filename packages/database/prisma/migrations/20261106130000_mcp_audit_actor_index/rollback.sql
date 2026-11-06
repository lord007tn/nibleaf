-- Dropping the index only slows audit lookups by person; no data is lost.
DROP INDEX CONCURRENTLY IF EXISTS "mcp_audit_event_actorUserId_createdAt_idx";
