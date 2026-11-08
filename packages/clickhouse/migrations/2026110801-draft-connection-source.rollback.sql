-- Deploy the previous application before removing this column. Existing connection attribution is lost.
ALTER TABLE analytics_events DROP COLUMN IF EXISTS connection_source;
ALTER TABLE analytics_schema_migrations DELETE WHERE version = 2026110801;
