-- Generated structural baseline: prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script.
-- Only task-owned changes from that baseline are included (existing drift is not repaired here).
BEGIN;
-- AlterTable
ALTER TABLE "invitation" ADD COLUMN "legacyWriter" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "kind" SET DEFAULT '__legacy__'::text,
ALTER COLUMN "orgRole" SET DEFAULT '__legacy__'::text;

-- AlterTable
ALTER TABLE "join_link" ADD COLUMN "legacyWriter" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "orgRole" SET DEFAULT '__legacy__'::text;

-- AlterTable
ALTER TABLE "member" ADD COLUMN     "legacyWriter" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "orgRole" SET DEFAULT '__legacy__'::text;

-- CreateTable
CREATE TABLE "org_merge_journal" (
    "run_id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "group_key" TEXT NOT NULL,
    "table_name" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,

    CONSTRAINT "org_merge_journal_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE INDEX "org_merge_journal_run_id_group_key_idx" ON "org_merge_journal"("run_id", "group_key");


-- Existing expanded rows came from legacy data; an explicit new-code orgRole
-- UPDATE clears this flag before any legacy-role synchronization can run.
UPDATE member SET "legacyWriter" = true;

CREATE FUNCTION legacy_org_handle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base text; candidate text; suffix integer := 1;
BEGIN
  IF NEW.slug IS NULL THEN
    -- One namespace, including aliases; serialize allocations, not just checks.
    PERFORM pg_advisory_xact_lock(813455, 1);
    base := trim(both '-' FROM regexp_replace(lower(NEW.name), '[^a-z0-9]+', '-', 'g'));
    base := trim(trailing '-' FROM left(base, 48));
    IF base = '' OR base IN ('new','settings','welcome','o','api','app','admin') THEN
      base := 'org-' || left(NEW.id, 6);
    END IF;
    candidate := base;
    WHILE EXISTS (SELECT 1 FROM organization_handle WHERE slug = candidate)
       OR EXISTS (SELECT 1 FROM organization WHERE slug = candidate)
    LOOP
      suffix := suffix + 1; candidate := base || '-' || suffix;
    END LOOP;
    NEW.slug := candidate;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER legacy_org_handle BEFORE INSERT ON organization
FOR EACH ROW EXECUTE FUNCTION legacy_org_handle();

-- Deferred: new code can create its explicit nested handle in the same tx.
CREATE FUNCTION legacy_org_register_handle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org record;
BEGIN
  SELECT * INTO org FROM organization WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM organization_handle WHERE "organizationId" = org.id AND current) THEN
    INSERT INTO organization_handle (slug, "organizationId", current) VALUES (org.slug, org.id, true);
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER legacy_org_register_handle AFTER INSERT ON organization
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION legacy_org_register_handle();

CREATE FUNCTION legacy_member_explicit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF current_setting('nibleaf.org_merge_restore',true) IS DISTINCT FROM 'on' THEN NEW."legacyWriter" := false; END IF; RETURN NEW; END $$;
CREATE TRIGGER b_member_explicit BEFORE UPDATE OF "orgRole" ON member
FOR EACH ROW EXECUTE FUNCTION legacy_member_explicit();

-- UPDATE OF distinguishes the columns in the SQL SET list even when the new
-- explicit orgRole equals the old value. A role-only writer is always legacy.
CREATE FUNCTION legacy_member_role_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('nibleaf.org_merge_restore',true) IS DISTINCT FROM 'on' THEN NEW."legacyWriter" := true; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_member_role_update BEFORE UPDATE OF role ON member
FOR EACH ROW EXECUTE FUNCTION legacy_member_role_update();

CREATE FUNCTION legacy_member_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sites integer;
BEGIN
  IF current_setting('nibleaf.org_merge_restore',true) = 'on' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW."legacyWriter" := NEW."orgRole" = '__legacy__';
  END IF;
  IF NOT NEW."legacyWriter" THEN RETURN NEW; END IF;
  PERFORM id FROM organization WHERE id = NEW."organizationId" FOR NO KEY UPDATE;
  SELECT count(*) INTO sites FROM project WHERE "organizationId" = NEW."organizationId";
  -- Zero websites is normal while old createProject is still in its transaction.
  -- Old images are unsupported after a merge; never fan a legacy grant out.
  IF sites > 1 THEN RAISE EXCEPTION 'Legacy membership writer requires a one-website organization'; END IF;
  NEW."orgRole" := CASE WHEN NEW.role = 'owner' AND NOT EXISTS
    (SELECT 1 FROM member WHERE "organizationId" = NEW."organizationId" AND "orgRole" = 'owner' AND id <> NEW.id)
    THEN 'owner' ELSE 'member' END;
  RETURN NEW;
END $$;
CREATE TRIGGER z_member_defaults BEFORE INSERT OR UPDATE OF role ON member
FOR EACH ROW EXECUTE FUNCTION legacy_member_defaults();

CREATE FUNCTION legacy_member_grants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW."legacyWriter" OR current_setting('nibleaf.org_merge_restore',true) = 'on' THEN RETURN NULL; END IF;
  DELETE FROM project_member WHERE "organizationId" = NEW."organizationId" AND "userId" = NEW."userId";
  IF NEW."orgRole" = 'member' AND NEW.role IN ('owner','admin','member','viewer') THEN
    INSERT INTO project_member (id,"organizationId","projectId","userId",role,"createdAt","updatedAt")
    SELECT 'legacy-' || NEW.id, NEW."organizationId", p.id, NEW."userId",
      CASE WHEN NEW.role = 'owner' THEN 'admin' ELSE NEW.role END, NEW."createdAt", CURRENT_TIMESTAMP
    FROM project p WHERE p."organizationId" = NEW."organizationId";
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER legacy_member_grants AFTER INSERT OR UPDATE OF role ON member
FOR EACH ROW EXECUTE FUNCTION legacy_member_grants();

CREATE FUNCTION legacy_admission_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE site text; legacy boolean;
BEGIN
  IF TG_TABLE_NAME = 'invitation' THEN legacy := NEW.kind = '__legacy__';
  ELSE legacy := NEW."orgRole" = '__legacy__'; END IF;
  IF NOT legacy THEN RETURN NEW; END IF;
  PERFORM id FROM organization WHERE id = NEW."organizationId" FOR NO KEY UPDATE;
  SELECT min(id) INTO site FROM project WHERE "organizationId" = NEW."organizationId"
    HAVING count(*) = 1;
  NEW."orgRole" := 'member';
  IF TG_TABLE_NAME = 'invitation' THEN
    NEW.kind := CASE WHEN NEW.role = 'owner' THEN 'bootstrap_owner' ELSE 'member' END;
    IF NEW.kind = 'bootstrap_owner' THEN NEW."orgRole" := 'owner'; END IF;
    IF site IS NULL OR NEW.role IS NULL OR NEW.role NOT IN ('owner','admin','member','viewer') THEN NEW.status := 'canceled'; END IF;
  ELSIF site IS NULL OR NEW.role NOT IN ('admin','member','viewer') THEN
    NEW."revokedAt" := COALESCE(NEW."revokedAt", CURRENT_TIMESTAMP);
  END IF;
  NEW."legacyWriter" := true;
  RETURN NEW;
END $$;
CREATE TRIGGER legacy_invitation_defaults BEFORE INSERT ON invitation FOR EACH ROW EXECUTE FUNCTION legacy_admission_defaults();
CREATE TRIGGER legacy_join_link_defaults BEFORE INSERT ON join_link FOR EACH ROW EXECUTE FUNCTION legacy_admission_defaults();

CREATE FUNCTION legacy_admission_grants() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW."legacyWriter" OR current_setting('nibleaf.org_merge_restore',true) = 'on' THEN RETURN NULL; END IF;
  IF NEW.role IN ('admin','member','viewer') THEN
    IF TG_TABLE_NAME = 'invitation' THEN
      INSERT INTO invitation_grant ("invitationId","organizationId","projectId",role)
      SELECT NEW.id, NEW."organizationId", min(id), NEW.role FROM project WHERE "organizationId" = NEW."organizationId" HAVING count(*) = 1;
    ELSE
      INSERT INTO join_link_grant ("joinLinkId","organizationId","projectId",role)
      SELECT NEW.id, NEW."organizationId", min(id), NEW.role FROM project WHERE "organizationId" = NEW."organizationId" HAVING count(*) = 1;
    END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER legacy_invitation_grants AFTER INSERT ON invitation FOR EACH ROW EXECUTE FUNCTION legacy_admission_grants();
CREATE TRIGGER legacy_join_link_grants AFTER INSERT ON join_link FOR EACH ROW EXECUTE FUNCTION legacy_admission_grants();

-- Legacy text metadata can contain valid JSON that JSONB cannot represent
-- (NUL/unpaired surrogate). Keep that legacy row intact; do not discard it or
-- fail an old writer. Unrepresentable values never enter new server-only JSONB.
CREATE FUNCTION legacy_metadata_json(value text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN RETURN COALESCE(value::jsonb,'{}'::jsonb);
EXCEPTION WHEN invalid_text_representation OR untranslatable_character THEN RETURN NULL;
END $$;

CREATE FUNCTION legacy_project_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."dataTenantId" <> NEW."organizationId" THEN RETURN NULL; END IF;
  INSERT INTO project_member (id,"organizationId","projectId","userId",role,"createdAt","updatedAt")
  SELECT 'legacy-' || m.id, m."organizationId", NEW.id, m."userId",
    CASE WHEN m.role = 'owner' THEN 'admin' ELSE m.role END, m."createdAt", CURRENT_TIMESTAMP
  FROM member m WHERE m."organizationId" = NEW."organizationId" AND m."legacyWriter" AND m."orgRole" = 'member'
    AND m.role IN ('owner','admin','member','viewer') ON CONFLICT ("projectId","userId") DO NOTHING;
  INSERT INTO project_git_settings ("projectId",settings)
  SELECT NEW.id, COALESCE(legacy_metadata_json(metadata)->'git','{}'::jsonb) - 'webhookSecret' FROM organization WHERE id=NEW."organizationId";
  INSERT INTO project_legacy_settings ("projectId",metadata)
  SELECT NEW.id, COALESCE(legacy_metadata_json(metadata),'{}'::jsonb) - ARRAY['plan','notifications','entitlements','git'] FROM organization WHERE id=NEW."organizationId";
  INSERT INTO project_git_webhook_secret ("projectId",secret)
  SELECT NEW.id, COALESCE(s.secret,legacy_metadata_json(o.metadata)->'git'->>'webhookSecret') FROM organization o
  LEFT JOIN organization_git_webhook_secret s ON s."organizationId"=o.id
  WHERE o.id=NEW."organizationId" AND COALESCE(s.secret,legacy_metadata_json(o.metadata)->'git'->>'webhookSecret') IS NOT NULL;
  RETURN NULL;
END $$;
CREATE TRIGGER legacy_project_defaults AFTER INSERT ON project FOR EACH ROW EXECUTE FUNCTION legacy_project_defaults();

CREATE FUNCTION legacy_join_redemption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."userId" IS NOT NULL THEN
    INSERT INTO join_link_redemption ("joinLinkId","userId","createdAt") VALUES (NEW."joinLinkId",NEW."userId",NEW."createdAt") ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER legacy_join_redemption AFTER INSERT ON join_link_use FOR EACH ROW EXECUTE FUNCTION legacy_join_redemption();
-- Old images still edit org-level settings. New images use project settings;
-- a one-site legacy mirror is copied exactly, never fanned out after a merge.
CREATE FUNCTION legacy_org_settings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE site text; meta jsonb; org_id text;
BEGIN
  IF current_setting('nibleaf.org_merge_restore',true) = 'on' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'organization' THEN org_id := NEW.id; ELSE org_id := NEW."organizationId"; END IF;
  SELECT min(id) INTO site FROM project WHERE "organizationId"=org_id HAVING count(*)=1;
  IF site IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'organization' THEN
    meta := legacy_metadata_json(NEW.metadata);
    IF meta IS NULL THEN RETURN NULL; END IF;
    INSERT INTO project_git_settings ("projectId",settings) VALUES (site,COALESCE(meta->'git','{}'::jsonb)-'webhookSecret')
      ON CONFLICT ("projectId") DO UPDATE SET settings=EXCLUDED.settings;
    INSERT INTO project_legacy_settings ("projectId",metadata) VALUES (site,meta-ARRAY['plan','notifications','entitlements','git'])
      ON CONFLICT ("projectId") DO UPDATE SET metadata=EXCLUDED.metadata;
    IF meta->'git'->>'webhookSecret' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_git_webhook_secret WHERE "organizationId"=org_id) THEN
      INSERT INTO project_git_webhook_secret ("projectId",secret) VALUES(site,meta->'git'->>'webhookSecret')
        ON CONFLICT ("projectId") DO UPDATE SET secret=EXCLUDED.secret;
    END IF;
  ELSE
    INSERT INTO project_git_webhook_secret ("projectId",secret) VALUES(site,NEW.secret)
      ON CONFLICT ("projectId") DO UPDATE SET secret=EXCLUDED.secret;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER legacy_org_settings AFTER UPDATE OF metadata ON organization FOR EACH ROW EXECUTE FUNCTION legacy_org_settings();
CREATE TRIGGER legacy_org_secret AFTER INSERT OR UPDATE ON organization_git_webhook_secret FOR EACH ROW EXECUTE FUNCTION legacy_org_settings();
UPDATE organization o SET "needsRepair"=true WHERE
 (SELECT count(*) FROM member m WHERE m."organizationId"=o.id AND m.role='owner') > 1;

COMMIT;
