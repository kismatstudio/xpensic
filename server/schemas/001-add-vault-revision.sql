-- Non-destructive migration for databases created before vault revisions.
-- Run once per existing database before deploying the revision-aware worker.
ALTER TABLE vault_blobs ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;