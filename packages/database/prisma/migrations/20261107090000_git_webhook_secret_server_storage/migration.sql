-- CreateTable
CREATE TABLE "organization_git_webhook_secret" (
    "organizationId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_git_webhook_secret_pkey" PRIMARY KEY ("organizationId")
);

-- AddForeignKey
ALTER TABLE "organization_git_webhook_secret" ADD CONSTRAINT "organization_git_webhook_secret_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: webhook secrets are server-only. Copy each `metadata.git.webhookSecret`
-- into the table above and remove the key from the organization metadata.
-- Metadata PostgreSQL cannot read as jsonb is left untouched and reported with
-- a WARNING naming the organization; the API moves any remaining copy on first
-- use. Idempotent: an existing table row is never overwritten.
DO $$
DECLARE
  org RECORD;
  parsed JSONB;
BEGIN
  FOR org IN SELECT "id", "metadata" FROM "organization" WHERE "metadata" LIKE '%webhookSecret%' LOOP
    BEGIN
      parsed := org."metadata"::jsonb;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'Git webhook secret not moved for organization %: metadata is not valid jsonb; the API moves it on first use.', org."id";
      CONTINUE;
    END;
    IF COALESCE(jsonb_typeof(parsed -> 'git'), '') <> 'object' OR NOT ((parsed -> 'git') ? 'webhookSecret') THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(parsed #> '{git,webhookSecret}') = 'string' AND length(parsed #>> '{git,webhookSecret}') > 0 THEN
      INSERT INTO "organization_git_webhook_secret" ("organizationId", "secret", "updatedAt")
      VALUES (org."id", parsed #>> '{git,webhookSecret}', CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId") DO NOTHING;
    END IF;
    UPDATE "organization" SET "metadata" = (parsed #- '{git,webhookSecret}')::text WHERE "id" = org."id";
  END LOOP;
END $$;
