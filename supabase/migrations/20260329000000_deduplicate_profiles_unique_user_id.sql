-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: deduplicate profiles and enforce UNIQUE on user_id
--
-- WHY: A race condition during early OAuth sign-ins (before the INSERT RLS
-- policy was applied) could create more than one profile row per user, causing
-- .maybeSingle() to throw "multiple rows returned".
--
-- WHAT:
--   1. Delete duplicate profile rows, keeping the oldest (first-created) one.
--   2. Add a UNIQUE constraint on profiles.user_id so this can never recur.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Remove duplicates — keep the earliest row per user_id
DELETE FROM public.profiles
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at ASC) AS rn
    FROM public.profiles
    WHERE user_id IS NOT NULL
  ) ranked
  WHERE rn > 1
);

-- 2. Add unique constraint (safe — idempotent via DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_user_id_key'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_user_id_key UNIQUE (user_id);
  END IF;
END $$;
