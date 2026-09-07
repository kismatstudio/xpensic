-- Non-destructive migration adding the feedback table for databases
-- created before the Feedback System landed. Run once per existing
-- database before deploying the feedback-aware worker:
--   npx wrangler d1 execute <db> --remote --file=./schemas/003-add-feedback.sql
CREATE TABLE IF NOT EXISTS feedback (
  id          TEXT PRIMARY KEY,
  userId      TEXT NOT NULL,
  userEmail   TEXT DEFAULT '',
  type        TEXT NOT NULL,          -- bug | feature | feedback
  subject     TEXT NOT NULL,
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'new',
  currentPage TEXT DEFAULT '',
  browser     TEXT DEFAULT '',
  deviceType  TEXT DEFAULT '',
  appVersion  TEXT DEFAULT '',
  submittedAt TEXT DEFAULT '',
  createdAt   TEXT DEFAULT '',
  updatedAt   TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(userId);
CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status);