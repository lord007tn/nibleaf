-- Stop the new worker/API before rollback. Snapshots are preserved; older readers use their legacy path.
ALTER TABLE "deployment" DROP COLUMN IF EXISTS "assetReferenceIndex", DROP COLUMN IF EXISTS "assetReferenceBytes",
 DROP COLUMN IF EXISTS "assetSourceBytes", DROP COLUMN IF EXISTS "assetSourcePages";
