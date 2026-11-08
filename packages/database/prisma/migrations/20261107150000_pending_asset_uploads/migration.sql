-- Track issued uploads separately from confirmed assets. Existing assets are unchanged.
CREATE TABLE "pending_asset_upload" (
    "key" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "urlExpiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '660 seconds'),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "cleanupStartedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    CONSTRAINT "pending_asset_upload_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "pending_asset_upload_size_check" CHECK ("size" > 0 AND "size" <= 52428800)
);

CREATE INDEX "pending_asset_upload_projectId_idx" ON "pending_asset_upload"("projectId");
CREATE INDEX "pending_asset_upload_expiresAt_key_idx" ON "pending_asset_upload"("expiresAt", "key");
CREATE INDEX "pending_asset_upload_cleanupStartedAt_expiresAt_key_idx" ON "pending_asset_upload"("cleanupStartedAt" DESC, "expiresAt", "key");
CREATE INDEX "pending_asset_upload_nextAttemptAt_idx" ON "pending_asset_upload"("nextAttemptAt");
ALTER TABLE "pending_asset_upload" ADD CONSTRAINT "pending_asset_upload_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Retain post-cleanup keys so late-finishing uploads remain reachable by maintenance.
CREATE TABLE "asset_upload_tombstone" (
    "key" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "urlExpiresAt" TIMESTAMP(3) NOT NULL,
    "firstRecheckedAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "asset_upload_tombstone_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "asset_upload_tombstone_size_check" CHECK ("size" > 0 AND "size" <= 52428800)
);
CREATE INDEX "asset_upload_tombstone_projectId_idx" ON "asset_upload_tombstone"("projectId");
CREATE INDEX "asset_upload_tombstone_projectId_firstRecheckedAt_idx" ON "asset_upload_tombstone"("projectId", "firstRecheckedAt");
CREATE INDEX "asset_upload_tombstone_nextCheckAt_key_idx" ON "asset_upload_tombstone"("nextCheckAt", "key");
CREATE INDEX "asset_upload_tombstone_nextAttemptAt_idx" ON "asset_upload_tombstone"("nextAttemptAt");
ALTER TABLE "asset_upload_tombstone" ADD CONSTRAINT "asset_upload_tombstone_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
