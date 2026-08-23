-- Operator rollback for 20260823180000_search_configuration_diagnostics.
-- Stop API and worker processes that may write search_index_run before running.
-- This removes diagnostics/run history only; indexed Qdrant points are unchanged.
DROP TABLE IF EXISTS "search_index_run";
DROP TYPE IF EXISTS "SearchIndexRunStatus";
