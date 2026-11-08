-- Asset requests read the private reference index separately from public snapshot bodies.
ALTER TABLE "deployment"
 ADD COLUMN "assetReferenceIndex" JSONB,
 ADD COLUMN "assetReferenceBytes" INTEGER,
 ADD COLUMN "assetSourceBytes" INTEGER,
 ADD COLUMN "assetSourcePages" INTEGER;
-- Bound legacy snapshot hydration before loading page bodies in the API process.
-- Only scalar metadata changes; published snapshots and deployment identity are preserved.
UPDATE "deployment" SET "assetSourceBytes" = octet_length("snapshot"::text),
 "assetSourcePages" = jsonb_array_length("snapshot"->'pages')
WHERE "snapshot" IS NOT NULL AND jsonb_typeof("snapshot"->'pages') = 'array';
