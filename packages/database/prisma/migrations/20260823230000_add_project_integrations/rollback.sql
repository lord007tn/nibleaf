-- Run only after every dependent MCP/control-plane migration has been rolled
-- back. This integration migration owns the shared nullable ApiKey.expiresAt
-- prerequisite; dropping it while MCP still depends on it is unsafe.

DROP TABLE IF EXISTS "integration_idempotency_record";
DROP TABLE IF EXISTS "integration_webhook_delivery";
DROP TABLE IF EXISTS "integration_confirmation";
DROP TABLE IF EXISTS "integration_audit_event";
DROP TABLE IF EXISTS "project_integration";

ALTER TABLE "api_key" DROP COLUMN IF EXISTS "expiresAt";
