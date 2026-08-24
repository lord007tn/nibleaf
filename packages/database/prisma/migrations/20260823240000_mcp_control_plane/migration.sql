ALTER TABLE "api_key"
  ADD COLUMN "createdById" TEXT,
  ADD COLUMN "rotatedFromId" TEXT;

-- This operator-managed table is expected to stay small. These standard Prisma
-- migration statements deliberately remain recoverable through the repository's
-- normal migration workflow; apply them in the documented low-activity window
-- with API-key lifecycle writes paused rather than using a partially resumable
-- concurrent-index procedure.
CREATE INDEX "api_key_createdById_idx" ON "api_key"("createdById");
CREATE INDEX "api_key_rotatedFromId_idx" ON "api_key"("rotatedFromId");
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Dashboard-authenticated routes previously created wildcard keys, but no API
-- consumer accepted them. Preserve unknown legacy scope strings for operator
-- review, remove only the wildcard, and add a conservative read-only set
-- without mcp:connect. Administrators must explicitly rotate these keys before
-- they can connect to MCP.
UPDATE "api_key"
SET "scopes" = ARRAY(
  SELECT DISTINCT scope
  FROM unnest("api_key"."scopes" || ARRAY['projects:read', 'pages:read', 'languages:read', 'versions:read']) AS scope
  WHERE scope <> '*'
)
WHERE '*' = ANY("scopes");

CREATE TABLE "mcp_audit_event" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "apiKeyId" TEXT,
  "requestId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "errorCode" TEXT,
  "durationMs" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mcp_audit_event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mcp_audit_event_projectId_createdAt_idx" ON "mcp_audit_event"("projectId", "createdAt");
CREATE INDEX "mcp_audit_event_apiKeyId_createdAt_idx" ON "mcp_audit_event"("apiKeyId", "createdAt");
CREATE INDEX "mcp_audit_event_requestId_idx" ON "mcp_audit_event"("requestId");
ALTER TABLE "mcp_audit_event" ADD CONSTRAINT "mcp_audit_event_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
