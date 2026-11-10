-- Design §3 rule 4: deleting an organization that still holds a website is
-- impossible. PR 1 kept ON DELETE CASCADE for its previous release (whose
-- erasure deleted the org and relied on the cascade). The rollback target of
-- this release is PR 1, which erases each website first and deletes the org
-- only once it holds none, so RESTRICT is safe from here on.
BEGIN;
ALTER TABLE "project" DROP CONSTRAINT "project_organizationId_fkey";
ALTER TABLE "project" ADD CONSTRAINT "project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
