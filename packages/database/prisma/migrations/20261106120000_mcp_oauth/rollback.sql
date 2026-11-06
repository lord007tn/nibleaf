-- Run only after the application has been rolled back to a version without
-- MCP OAuth (and with MCP_ENABLED unset or false on every image that still
-- loads the better-auth MCP plugins). Dropping these tables signs every OAuth
-- client out, forgets registered clients and signing keys, and discards which
-- project each connection was bound to. API keys are unaffected.

-- OAuth-only replay rows have no API key id; they must go before apiKeyId is
-- required again. Audit rows keep their history with a null apiKeyId.
DELETE FROM "mcp_idempotency_record" WHERE "apiKeyId" IS NULL;
DROP INDEX IF EXISTS "mcp_idempotency_record_oauthGrantId_operation_clientRequest_key";
ALTER TABLE "mcp_idempotency_record"
  DROP COLUMN IF EXISTS "oauthGrantId",
  ALTER COLUMN "apiKeyId" SET NOT NULL;

DROP INDEX IF EXISTS "mcp_audit_event_oauthGrantId_createdAt_idx";
ALTER TABLE "mcp_audit_event" DROP COLUMN IF EXISTS "oauthGrantId";

-- Children before parents, so no foreign key blocks a drop.
DROP TABLE IF EXISTS "mcp_oauth_grant";
DROP TABLE IF EXISTS "oauth_consent";
DROP TABLE IF EXISTS "oauth_access_token";
DROP TABLE IF EXISTS "oauth_refresh_token";
DROP TABLE IF EXISTS "oauth_client_resource";
DROP TABLE IF EXISTS "oauth_resource";
DROP TABLE IF EXISTS "oauth_client_assertion";
DROP TABLE IF EXISTS "oauth_client";
DROP TABLE IF EXISTS "jwks";
