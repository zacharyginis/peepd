-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: profile INSERT policy + missing columns
-- 
-- WHY: The original schema only had SELECT and UPDATE policies on `profiles`.
-- New users signing in via OAuth couldn't create their own profile row because
-- there was no INSERT policy — causing my-profile.html to appear completely empty.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add missing profile columns (safe on existing DBs — idempotent)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS website      text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS industry     text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS linkedin_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url   text; -- LinkedIn / Facebook profile photo

-- 2. Add INSERT policy so authenticated users can create their own profile row
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 3. Also add review_disputes table if it doesn't exist (was only in schema.sql)
CREATE TABLE IF NOT EXISTS public.review_disputes (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz not null default now(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid references auth.users(id) on delete set null,
  reason      text not null check (reason in (
                 'false_info','mistaken_identity','harassment','spam','privacy','other')),
  details     text,
  status      text not null default 'pending'
                check (status in ('pending','under_review','resolved')),
  unique (review_id, reporter_id)
);

ALTER TABLE public.review_disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can submit disputes" ON public.review_disputes;
CREATE POLICY "Authenticated users can submit disputes"
  ON public.review_disputes FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can view their own disputes" ON public.review_disputes;
CREATE POLICY "Users can view their own disputes"
  ON public.review_disputes FOR SELECT
  USING (auth.uid() = reporter_id);

-- 4. Waitlist table (may already exist)
CREATE TABLE IF NOT EXISTS public.waitlist (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),
  full_name       text not null,
  email           text not null unique,
  linkedin_url    text,
  birthdate       date,
  referral_source text,
  status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected'))
);

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can join waitlist" ON public.waitlist;
CREATE POLICY "Anyone can join waitlist"
  ON public.waitlist FOR INSERT WITH CHECK (true);
