-- Explicit operator rollback for the provider-neutral usage schema.
-- Prisma Migrate does not execute this file automatically. Stop consumers and
-- preserve reconciliation evidence before running it.
DROP TABLE IF EXISTS "usage_ingest_checkpoint";
DROP TABLE IF EXISTS "usage_storage_marker";
DROP TABLE IF EXISTS "usage_provider_checkpoint";
DROP TABLE IF EXISTS "organization_usage_plan";
DROP TABLE IF EXISTS "usage_entitlement";
DROP TABLE IF EXISTS "usage_plan_meter";
DROP TABLE IF EXISTS "usage_meter";
DROP TABLE IF EXISTS "usage_plan";
