-- Stop the pending-upload sweeper and roll back the application before dropping this table.
-- Confirmed assets and stored objects are preserved. Export pending rows, including rejectedAt records,
-- and tombstones (size, URL expiry, rechecks and retry state) before dropping the tables if cleanup will be resumed later.
DROP TABLE IF EXISTS "asset_upload_tombstone";
DROP TABLE IF EXISTS "pending_asset_upload";
