-- Existing READY deployments predate durable delivery receipts, including API
-- rollbacks. Fence them without replaying notifications, indexing, or analytics.
-- This administrative marker is deliberately not a publish_ready activation.
INSERT INTO "platform_event" ("id", "type", "projectId", "metadata", "createdAt")
SELECT 'publish-ready:' || d."id", 'publish_delivery_backfilled', d."projectId",
       jsonb_build_object('backfillMigration', '20261107110000_publish_delivery_backfill', 'version', d."version"), now()
FROM "deployment" d
WHERE d."status" = 'READY'
ON CONFLICT ("id") DO NOTHING;
