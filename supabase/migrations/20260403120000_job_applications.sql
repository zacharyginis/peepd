-- ============================================================
-- Job Applications table
-- Stores inbound applications for open positions at Peepd
-- ============================================================

CREATE TABLE IF NOT EXISTS public.job_applications (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  position      TEXT        NOT NULL,
  full_name     TEXT        NOT NULL,
  email         TEXT        NOT NULL,
  phone         TEXT,
  linkedin_url  TEXT,
  portfolio_url TEXT,
  location      TEXT,
  why_peepd     TEXT,
  experience    TEXT,
  status        TEXT        NOT NULL DEFAULT 'new',   -- new | reviewing | interviewed | offered | rejected
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for filtering by position / status
CREATE INDEX IF NOT EXISTS idx_job_applications_position ON public.job_applications (position);
CREATE INDEX IF NOT EXISTS idx_job_applications_status   ON public.job_applications (status);

-- RLS: anyone can INSERT (public application form), only service_role can read
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a job application"
  ON public.job_applications
  FOR INSERT
  WITH CHECK (true);

-- No SELECT policy for anon — applications are private
