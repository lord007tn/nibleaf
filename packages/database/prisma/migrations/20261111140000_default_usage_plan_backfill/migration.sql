-- Every organization is on a plan (usage owns default provisioning). Creation
-- paths assign the free plan in the same transaction since #105; this
-- re-asserts it for any organization that still has no assignment, exactly
-- like #105's backfill. Idempotent and additive: an existing assignment
-- (active, expired or paid) is never touched.
INSERT INTO "usage_plan" ("id", "key", "name", "version", "active", "createdAt", "updatedAt")
VALUES ('usage_plan_free_v1', 'free', 'Free', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "organization_usage_plan" ("organizationId", "planId", "status", "effectiveAt", "createdAt", "updatedAt")
SELECT organization."id", free_plan."id", 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organization" AS organization
CROSS JOIN "usage_plan" AS free_plan
WHERE free_plan."key" = 'free'
  AND NOT EXISTS (SELECT 1 FROM "organization_usage_plan" assigned WHERE assigned."organizationId" = organization."id")
ON CONFLICT ("organizationId") DO NOTHING;
