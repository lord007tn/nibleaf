-- Run only after the application has been rolled back to a version without
-- join links. Dropping these tables removes every join link and its audit
-- trail; people who already joined keep their membership (it lives in
-- "member"), and existing links simply stop working.
DROP TABLE IF EXISTS "join_link_use";
DROP TABLE IF EXISTS "join_link";
