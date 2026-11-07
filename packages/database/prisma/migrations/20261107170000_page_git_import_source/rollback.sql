-- Run only after the application has been rolled back to a version without
-- the page_git_import_source table. Dropping it forgets which repository file
-- each Git-imported page came from: the older importer matches files to pages
-- by folder and slug again, and does not read identities from page settings,
-- so nothing is copied back into "page"."config". Page content is unaffected.
DROP TABLE IF EXISTS "page_git_import_source";
