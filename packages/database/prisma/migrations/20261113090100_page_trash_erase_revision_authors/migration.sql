-- #492: Trash payloads now carry page history (`revisions`). When an account is
-- deleted, its comments already leave every Trash payload; its authorship of
-- trashed revisions must go too, exactly as `page_revision.userId` is SET NULL
-- for live pages. Same trigger, function body replaced in place.
-- nibleaf-migration: contract CREATE OR REPLACE of the page_trash_erase_user trigger function; it keeps the comment removal and only also nulls userId inside payload.revisions, a key the previous release ignores
CREATE OR REPLACE FUNCTION page_trash_erase_user() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "page_trash"
  SET "payload" = jsonb_set(
    "payload",
    '{comments}',
    COALESCE(
      (SELECT jsonb_agg(comment) FROM jsonb_array_elements("payload"->'comments') AS comment WHERE comment->>'userId' IS DISTINCT FROM OLD.id),
      '[]'::jsonb
    )
  )
  WHERE jsonb_typeof("payload"->'comments') = 'array'
    AND "payload"->'comments' @> jsonb_build_array(jsonb_build_object('userId', OLD.id));
  UPDATE "page_trash"
  SET "payload" = jsonb_set(
    "payload",
    '{revisions}',
    (
      SELECT jsonb_agg(
        CASE WHEN revision->>'userId' = OLD.id THEN jsonb_set(revision, '{userId}', 'null'::jsonb) ELSE revision END
        ORDER BY position
      )
      FROM jsonb_array_elements("payload"->'revisions') WITH ORDINALITY AS entries(revision, position)
    )
  )
  WHERE jsonb_typeof("payload"->'revisions') = 'array'
    AND "payload"->'revisions' @> jsonb_build_array(jsonb_build_object('userId', OLD.id));
  RETURN OLD;
END $$;
