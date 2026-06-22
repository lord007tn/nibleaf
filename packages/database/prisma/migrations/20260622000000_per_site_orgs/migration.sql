-- Per-site organizations: each Project owns its own Organization (1:1), so that
-- the org IS the site's member boundary (members / roles / invitations are
-- per-site). Existing data is already 1:1 here, but this backfill safely splits
-- any org that holds more than one project: mint a dedicated org per extra
-- project, copy that org's members + pending invitations into it, then repoint
-- the project. Original "account" orgs are kept (they still anchor a session's
-- activeOrganizationId and any members they hold).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS _site_split;
CREATE TEMP TABLE _site_split AS
SELECT p.id AS project_id,
       p."organizationId" AS src_org,
       gen_random_uuid()::text AS new_org
FROM "project" p
WHERE p."organizationId" IN (
  SELECT "organizationId" FROM "project" GROUP BY "organizationId" HAVING count(*) > 1
);

-- Mint a dedicated org per split project (slug NULL to dodge the global unique slug).
INSERT INTO "organization" (id, name, slug, metadata, "createdAt")
SELECT s.new_org, COALESCE(p.name, 'Site'), NULL, NULL, CURRENT_TIMESTAMP
FROM _site_split s JOIN "project" p ON p.id = s.project_id;

-- Copy members from the source org into each new org (fresh ids; roles verbatim).
INSERT INTO "member" (id, "organizationId", "userId", role, "createdAt")
SELECT gen_random_uuid()::text, s.new_org, m."userId", m.role, CURRENT_TIMESTAMP
FROM _site_split s JOIN "member" m ON m."organizationId" = s.src_org;

-- Copy pending invitations.
INSERT INTO "invitation" (id, "organizationId", email, role, status, "expiresAt", "inviterId")
SELECT gen_random_uuid()::text, s.new_org, i.email, i.role, i.status, i."expiresAt", i."inviterId"
FROM _site_split s JOIN "invitation" i ON i."organizationId" = s.src_org AND i.status = 'pending';

-- Repoint each split project at its own org.
UPDATE "project" p SET "organizationId" = s.new_org
FROM _site_split s WHERE p.id = s.project_id;

DROP TABLE IF EXISTS _site_split;

-- Enforce the 1:1 invariant going forward.
DROP INDEX "project_organizationId_idx";
CREATE UNIQUE INDEX "project_organizationId_key" ON "project"("organizationId");
