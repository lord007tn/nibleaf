-- MCP write path: attribute every audited operation to the dashboard user who
-- created the API key and to the entity it touched, and keep a short-lived
-- replay cache so a retried write with the same clientRequestId is applied
-- once. Neither table stores tool inputs or page content.

-- New audit columns are nullable so existing read-only rows stay valid and old
-- application images that do not write them keep working during a rollout.
ALTER TABLE "mcp_audit_event"
  ADD COLUMN "actorUserId" TEXT,
  ADD COLUMN "targetType" TEXT,
  ADD COLUMN "targetId" TEXT,
  ADD COLUMN "clientRequestId" TEXT;

-- The actor index on this existing, possibly large table is built CONCURRENTLY
-- in 20261106130000_mcp_audit_actor_index, so audit inserts keep flowing.

-- One row per (key, operation, clientRequestId). `argsHash` is the SHA-256 of
-- the canonical tool arguments; `result` is a compact summary (ids, revision,
-- status) replayed for an identical retry. Rows expire after 24 hours and are
-- pruned lazily per project by the MCP server.
CREATE TABLE "mcp_idempotency_record" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "apiKeyId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "clientRequestId" TEXT NOT NULL,
  "argsHash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mcp_idempotency_record_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_idempotency_record_apiKeyId_operation_clientRequestId_key"
  ON "mcp_idempotency_record"("apiKeyId", "operation", "clientRequestId");
CREATE INDEX "mcp_idempotency_record_projectId_expiresAt_idx" ON "mcp_idempotency_record"("projectId", "expiresAt");
ALTER TABLE "mcp_idempotency_record" ADD CONSTRAINT "mcp_idempotency_record_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
