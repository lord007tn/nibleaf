-- Nullable and without a backfill: existing READY snapshots are unchanged; manual pending jobs without reviewed input fail closed.
ALTER TABLE "deployment" ADD COLUMN "approvedSnapshot" JSONB;
