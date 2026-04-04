-- ============================================================
-- Migrate reviewer_verifications from Didit to Persona
-- Renames didit_session_id → persona_inquiry_id
-- ============================================================

-- Rename the column
ALTER TABLE public.reviewer_verifications
  RENAME COLUMN didit_session_id TO persona_inquiry_id;

-- Drop the old unique constraint and recreate for the new column name
ALTER TABLE public.reviewer_verifications
  DROP CONSTRAINT IF EXISTS reviewer_verifications_didit_session_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS reviewer_verifications_persona_inquiry_id_key
  ON public.reviewer_verifications (persona_inquiry_id);
