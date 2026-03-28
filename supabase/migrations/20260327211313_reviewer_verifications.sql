-- Migration: reviewer_verifications table
-- Stores Didit KYC/face verification results for reviewers

CREATE TABLE IF NOT EXISTS reviewer_verifications (
  id                  UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  reviewer_session_id TEXT        NOT NULL,
  didit_session_id    TEXT        UNIQUE,
  status              TEXT        NOT NULL DEFAULT 'pending',
  verified_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviewer_verifications_session
  ON reviewer_verifications (reviewer_session_id);

-- RLS: Edge function uses service role key (bypasses RLS).
-- Anon users can read their own row by reviewer_session_id.
ALTER TABLE reviewer_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon can read own verification"
  ON reviewer_verifications FOR SELECT
  USING (true);
