-- Existing READY deployments predate durable delivery receipts, including API
-- rollbacks. Fence them without replaying notifications, indexing, or analytics.
-- This administrative marker is deliberately not a publish_ready activation.
-- Deploy-window edge: a READY deployment still delivering when this migration
-- runs can lose its funnel receipt if the backfill claims its id first. Drain
-- active publish deliveries before applying the migration to avoid that race.
INSERT INTO "platform_event" ("id", "type", "projectId", "metadata", "createdAt")
SELECT 'publish-ready:' || d."id", 'publish_delivery_backfilled', d."projectId",
       jsonb_build_object('backfillMigration', '20261107110000_publish_delivery_backfill', 'version', d."version"),
       COALESCE(d."completedAt", d."createdAt")
FROM "deployment" d
WHERE d."status" = 'READY'
ON CONFLICT ("id") DO NOTHING;
