-- Run only after the application has been rolled back to a version that reads
-- the one-way Git webhook secret from `organization.metadata`. That version
-- verifies push webhooks only with `metadata.git.webhookSecret`, so each stored
-- secret is copied back there first; without it, every legacy push webhook is
-- rejected until an admin rotates the secret.
--
-- The restored copy is readable again by every workspace member through the
-- auth organization endpoints. Treat the secret as exposed from the moment this
-- runs; rotate it right after re-upgrading, once old replicas are drained.

DO $$
DECLARE
  stored RECORD;
  parsed JSONB;
BEGIN
  IF to_regclass('"organization_git_webhook_secret"') IS NULL THEN
    RETURN;
  END IF;
  FOR stored IN
    SELECT s."organizationId", s."secret", o."metadata"
    FROM "organization_git_webhook_secret" s
    JOIN "organization" o ON o."id" = s."organizationId"
  LOOP
    BEGIN
      parsed := COALESCE(NULLIF(stored."metadata", ''), '{}')::jsonb;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'Git webhook secret not restored for organization %: metadata is not valid jsonb; rotate it after rollback.', stored."organizationId";
      CONTINUE;
    END;
    IF jsonb_typeof(parsed) <> 'object' THEN
      RAISE WARNING 'Git webhook secret not restored for organization %: metadata is not a JSON object; rotate it after rollback.', stored."organizationId";
      CONTINUE;
    END IF;
    IF jsonb_typeof(parsed -> 'git') IS DISTINCT FROM 'object' THEN
      parsed := jsonb_set(parsed, '{git}', '{}'::jsonb);
    END IF;
    UPDATE "organization"
    SET "metadata" = jsonb_set(parsed, '{git,webhookSecret}', to_jsonb(stored."secret"))::text
    WHERE "id" = stored."organizationId";
  END LOOP;
END $$;

DROP TABLE IF EXISTS "organization_git_webhook_secret";
