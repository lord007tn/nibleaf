ALTER TABLE "pending_asset_upload" ADD COLUMN "uploadTokenHash" TEXT,
  ADD COLUMN "uploadClaimedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "pending_asset_upload_uploadTokenHash_key" ON "pending_asset_upload"("uploadTokenHash");
