-- Expand only: legacy role columns are deliberately never updated.
BEGIN;
-- DropForeignKey
ALTER TABLE "project" DROP CONSTRAINT "project_organizationId_fkey";

-- DropIndex
DROP INDEX "project_organizationId_key";

-- AlterTable
ALTER TABLE "organization" ADD COLUMN     "deletionStartedAt" TIMESTAMP(3),
ADD COLUMN     "needsRepair" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "member" ADD COLUMN     "orgRole" TEXT NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE "invitation" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'member',
ADD COLUMN     "orgRole" TEXT NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE "join_link" ADD COLUMN     "orgRole" TEXT NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "organizationId" TEXT;

-- CreateTable
CREATE TABLE "project_member" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_grant" (
    "invitationId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "invitation_grant_pkey" PRIMARY KEY ("invitationId","projectId")
);

-- CreateTable
CREATE TABLE "join_link_grant" (
    "joinLinkId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "join_link_grant_pkey" PRIMARY KEY ("joinLinkId","projectId")
);

-- CreateTable
CREATE TABLE "join_link_redemption" (
    "joinLinkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "join_link_redemption_pkey" PRIMARY KEY ("joinLinkId","userId")
);

-- CreateTable
CREATE TABLE "organization_handle" (
    "slug" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "current" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_handle_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "user_preference" (
    "userId" TEXT NOT NULL,
    "lastOrganizationId" TEXT,
    "recentProjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notifications" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preference_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "project_member_organizationId_userId_idx" ON "project_member"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "project_member_projectId_userId_key" ON "project_member"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_id_organizationId_key" ON "invitation"("id", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "join_link_id_organizationId_key" ON "join_link"("id", "organizationId");

-- CreateIndex
CREATE INDEX "project_organizationId_idx" ON "project"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "project_id_organizationId_key" ON "project"("id", "organizationId");

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

-- AddForeignKey
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_organizationId_userId_fkey" FOREIGN KEY ("organizationId", "userId") REFERENCES "member"("organizationId", "userId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

-- AddForeignKey
ALTER TABLE "invitation_grant" ADD CONSTRAINT "invitation_grant_invitationId_organizationId_fkey" FOREIGN KEY ("invitationId", "organizationId") REFERENCES "invitation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

-- AddForeignKey
ALTER TABLE "invitation_grant" ADD CONSTRAINT "invitation_grant_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

-- AddForeignKey
ALTER TABLE "join_link_grant" ADD CONSTRAINT "join_link_grant_joinLinkId_organizationId_fkey" FOREIGN KEY ("joinLinkId", "organizationId") REFERENCES "join_link"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

-- AddForeignKey
ALTER TABLE "join_link_grant" ADD CONSTRAINT "join_link_grant_projectId_organizationId_fkey" FOREIGN KEY ("projectId", "organizationId") REFERENCES "project"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE DEFERRABLE INITIALLY IMMEDIATE;

-- AddForeignKey
ALTER TABLE "join_link_redemption" ADD CONSTRAINT "join_link_redemption_joinLinkId_fkey" FOREIGN KEY ("joinLinkId") REFERENCES "join_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_link_redemption" ADD CONSTRAINT "join_link_redemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_handle" ADD CONSTRAINT "organization_handle_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preference" ADD CONSTRAINT "user_preference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep every valid existing handle before allocating generated names. This
-- prevents a generated name from taking a later organization's existing slug.
INSERT INTO organization_handle (slug, "organizationId", current)
SELECT slug, id, true FROM organization
WHERE slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 48
  AND slug NOT IN ('new','settings','welcome','o','api','app','admin');
UPDATE organization o SET slug = NULL WHERE NOT EXISTS
  (SELECT 1 FROM organization_handle h WHERE h."organizationId" = o.id);

DO $$
DECLARE org RECORD; base TEXT; candidate TEXT; suffix INTEGER;
BEGIN
  FOR org IN SELECT * FROM organization o WHERE NOT EXISTS
    (SELECT 1 FROM organization_handle h WHERE h."organizationId" = o.id)
    ORDER BY "createdAt", id
  LOOP
    base := trim(both '-' FROM regexp_replace(lower(org.name), '[^a-z0-9]+', '-', 'g'));
    base := trim(trailing '-' FROM left(base, 48));
    IF base = '' OR base IN ('new','settings','welcome','o','api','app','admin') THEN
      base := 'org-' || left(org.id, 6);
    END IF;
    candidate := base; suffix := 1;
    WHILE EXISTS (SELECT 1 FROM organization_handle WHERE slug = candidate)
    LOOP
      suffix := suffix + 1; candidate := base || '-' || suffix;
    END LOOP;
    INSERT INTO organization_handle (slug, "organizationId", current) VALUES (candidate, org.id, true);
    UPDATE organization SET slug = candidate WHERE id = org.id;
  END LOOP;
END $$;
ALTER TABLE organization ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX organization_handle_one_current ON organization_handle ("organizationId") WHERE current;
ALTER TABLE organization_handle ADD CONSTRAINT organization_handle_slug_check CHECK
  (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND slug NOT IN ('new','settings','welcome','o','api','app','admin'));

-- Pick the earliest legacy owner, never promote a legacy site admin to org admin.
WITH owners AS (
  SELECT id, row_number() OVER (PARTITION BY "organizationId" ORDER BY "createdAt", id) AS n
  FROM member WHERE role = 'owner'
)
UPDATE member SET "orgRole" = 'owner' FROM owners WHERE member.id = owners.id AND owners.n = 1;
UPDATE organization o SET "needsRepair" = true
WHERE NOT EXISTS (SELECT 1 FROM member m WHERE m."organizationId" = o.id AND m."orgRole" = 'owner');

INSERT INTO project_member (id, "organizationId", "projectId", "userId", role, "createdAt", "updatedAt")
SELECT 'legacy-' || m.id, m."organizationId", p.id, m."userId",
  CASE WHEN m.role = 'owner' THEN 'admin' ELSE m.role END, m."createdAt", CURRENT_TIMESTAMP
FROM member m JOIN project p ON p."organizationId" = m."organizationId"
WHERE m."orgRole" = 'member' AND m.role IN ('owner','admin','member','viewer');

UPDATE invitation SET kind = 'bootstrap_owner', "orgRole" = 'owner' WHERE role = 'owner';
INSERT INTO invitation_grant ("invitationId", "organizationId", "projectId", role)
SELECT i.id, i."organizationId", p.id, i.role FROM invitation i JOIN project p ON p."organizationId" = i."organizationId"
WHERE i.status = 'pending' AND i.role IN ('admin','member','viewer');
INSERT INTO join_link_grant ("joinLinkId", "organizationId", "projectId", role)
SELECT j.id, j."organizationId", p.id, j.role FROM join_link j JOIN project p ON p."organizationId" = j."organizationId"
WHERE j.role IN ('admin','member','viewer');
UPDATE invitation i SET status = 'canceled' WHERE status = 'pending'
  AND (NOT EXISTS (SELECT 1 FROM project p WHERE p."organizationId" = i."organizationId")
       OR (kind = 'member' AND role NOT IN ('admin','member','viewer')) OR role IS NULL);
UPDATE join_link j SET "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP)
WHERE NOT EXISTS (SELECT 1 FROM project p WHERE p."organizationId" = j."organizationId")
  OR role NOT IN ('admin','member','viewer');
INSERT INTO join_link_redemption ("joinLinkId", "userId", "createdAt")
SELECT "joinLinkId", "userId", min("createdAt") FROM join_link_use WHERE "userId" IS NOT NULL GROUP BY "joinLinkId", "userId";

-- metadata is legacy text, and malformed JSON must not abort the expansion.
CREATE FUNCTION pg_temp.org_metadata(value TEXT) RETURNS JSONB LANGUAGE plpgsql AS $$
BEGIN RETURN value::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN '{}'::jsonb; END $$;
INSERT INTO user_preference ("userId", "recentProjectIds", notifications, "updatedAt")
SELECT u.id, ARRAY[]::TEXT[], COALESCE((
  SELECT jsonb_object_agg(toggle, enabled) FROM (
    SELECT toggle, NOT bool_and(COALESCE(pg_temp.org_metadata(o.metadata)->'notifications'->toggle = 'false'::jsonb, false)) AS enabled
    FROM member m JOIN organization o ON o.id = m."organizationId"
    CROSS JOIN unnest(ARRAY['workspace_weekly','workspace_plan','project_new','project_deploy','project_deploy_failed','member_joined','security_login']) AS toggle
    WHERE m."userId" = u.id GROUP BY toggle
  ) prefs
), '{}'::jsonb), CURRENT_TIMESTAMP FROM "user" u;

ALTER TABLE member ADD CONSTRAINT member_org_role_check CHECK ("orgRole" IN ('owner','admin','member'));
CREATE UNIQUE INDEX member_one_org_owner ON member ("organizationId") WHERE "orgRole" = 'owner';
ALTER TABLE project_member ADD CONSTRAINT project_member_role_check CHECK (role IN ('admin','member','viewer'));
ALTER TABLE invitation ADD CONSTRAINT invitation_kind_role_check CHECK
  ((kind = 'member' AND "orgRole" IN ('admin','member')) OR (kind = 'bootstrap_owner' AND "orgRole" = 'owner'));
ALTER TABLE invitation_grant ADD CONSTRAINT invitation_grant_role_check CHECK (role IN ('admin','member','viewer'));
ALTER TABLE join_link ADD CONSTRAINT join_link_org_role_check CHECK ("orgRole" = 'member');
ALTER TABLE join_link_grant ADD CONSTRAINT join_link_grant_role_check CHECK (role IN ('admin','member','viewer'));

DO $$
DECLARE repaired INTEGER; multiple INTEGER; unknown_roles INTEGER;
BEGIN
  SELECT count(*) INTO repaired FROM organization WHERE "needsRepair";
  SELECT count(*) INTO multiple FROM (SELECT "organizationId" FROM member WHERE role = 'owner' GROUP BY "organizationId" HAVING count(*) > 1) o;
  SELECT count(*) INTO unknown_roles FROM member WHERE role NOT IN ('owner','admin','member','viewer');
  RAISE NOTICE 'Organization expansion: % ownerless organizations quarantined, % multi-owner organizations reduced, % unknown member roles denied grants', repaired, multiple, unknown_roles;
END $$;
COMMIT;

