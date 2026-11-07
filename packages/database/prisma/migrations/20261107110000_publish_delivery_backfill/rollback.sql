-- Stop delivery-recovery workers before removing these fences. Do not restart
-- an unbounded recovery worker against the unfenced history. Keep genuine
-- publication and announcement receipts intact.
DELETE FROM "platform_event"
WHERE "type" = 'publish_delivery_backfilled'
  AND "metadata"->>'backfillMigration' = '20261107110000_publish_delivery_backfill';
