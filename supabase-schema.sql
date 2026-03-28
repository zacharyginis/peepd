-- ══════════════════════════════════════════════════════════════════════════════
-- Peepd — Supabase Database Schema
-- Run this in: Supabase Dashboard → SQL Editor
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Extensions ────────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── Profiles ──────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                uuid primary key default uuid_generate_v4(),
  created_at        timestamptz not null default now(),
  full_name         text not null,
  title             text,
  company           text,
  location          text,
  bio               text,
  initials          text,                         -- e.g. "AM"
  avatar_class      text default 'avatar-1',      -- CSS class for color
  peep_score        integer not null default 0 check (peep_score between 0 and 1000),
  tier              text generated always as (
    case
      when peep_score between 0   and 200  then 'Phantom'
      when peep_score between 201 and 400  then 'Emerging'
      when peep_score between 401 and 600  then 'Established'
      when peep_score between 601 and 800  then 'Trusted'
      when peep_score between 801 and 950  then 'Elite'
      else                                      'Legendary'
    end
  ) stored,
  review_count      integer not null default 0,
  accuracy_rate     numeric(5,2) not null default 0,
  is_verified       boolean not null default false,
  user_id           uuid references auth.users(id) on delete set null  -- linked auth user (optional)
);

-- Public read, authenticated insert/update
alter table public.profiles enable row level security;

create policy "Profiles are publicly readable"
  on public.profiles for select using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

-- ── Reviews ───────────────────────────────────────────────────────────────────
create table if not exists public.reviews (
  id                    uuid primary key default uuid_generate_v4(),
  created_at            timestamptz not null default now(),
  profile_id            uuid not null references public.profiles(id) on delete cascade,
  -- reviewer is always anonymous — we store their auth.uid only server-side
  reviewer_id           uuid references auth.users(id) on delete set null,
  relationship          text not null check (relationship in ('colleague','manager','report','friend','classmate','other')),
  -- Per-category ratings (1–5)
  rating_work_ethic     smallint check (rating_work_ethic     between 1 and 5),
  rating_reliability    smallint check (rating_reliability    between 1 and 5),
  rating_honesty        smallint check (rating_honesty        between 1 and 5),
  rating_character      smallint check (rating_character      between 1 and 5),
  rating_intelligence   smallint check (rating_intelligence   between 1 and 5),
  rating_social_skills  smallint check (rating_social_skills  between 1 and 5),
  review_text           text not null check (char_length(review_text) >= 80),
  -- Accuracy
  yes_votes             integer not null default 0,
  no_votes              integer not null default 0,
  accuracy_pct          numeric(5,2) generated always as (
    case when (yes_votes + no_votes) = 0 then null
    else round((yes_votes::numeric / (yes_votes + no_votes)) * 100, 2)
    end
  ) stored,
  accuracy_status       text generated always as (
    case
      when (yes_votes + no_votes) < 5 then 'pending'
      when (yes_votes::numeric / nullif(yes_votes + no_votes, 0)) >= 0.80 then 'accurate'
      when (yes_votes::numeric / nullif(yes_votes + no_votes, 0)) >= 0.60 then 'disputed'
      else 'inaccurate'
    end
  ) stored
);

-- Block self-reviews at the database level
create or replace function public.prevent_self_review()
returns trigger language plpgsql security definer as $$
declare
  profile_owner uuid;
begin
  select user_id into profile_owner from public.profiles where id = new.profile_id;
  if profile_owner is not null and profile_owner = new.reviewer_id then
    raise exception 'Self-reviews are not permitted on Peepd.';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_self_review
  before insert on public.reviews
  for each row execute function public.prevent_self_review();

-- RLS
alter table public.reviews enable row level security;

create policy "Reviews are publicly readable"
  on public.reviews for select using (true);

create policy "Authenticated users can submit reviews"
  on public.reviews for insert
  with check (auth.role() = 'authenticated');

-- ── Accuracy Votes ────────────────────────────────────────────────────────────
create table if not exists public.accuracy_votes (
  id          uuid primary key default uuid_generate_v4(),
  created_at  timestamptz not null default now(),
  review_id   uuid not null references public.reviews(id) on delete cascade,
  voter_id    uuid references auth.users(id) on delete set null,
  vote        text not null check (vote in ('yes', 'no')),
  -- One vote per user per review
  unique (review_id, voter_id)
);

alter table public.accuracy_votes enable row level security;

create policy "Votes are publicly readable"
  on public.accuracy_votes for select using (true);

create policy "Authenticated users can vote once per review"
  on public.accuracy_votes for insert
  with check (auth.role() = 'authenticated');

-- ── Trigger: update review vote counts when a vote is cast ───────────────────
create or replace function public.update_review_vote_counts()
returns trigger language plpgsql security definer as $$
begin
  update public.reviews
  set
    yes_votes = (select count(*) from public.accuracy_votes where review_id = new.review_id and vote = 'yes'),
    no_votes  = (select count(*) from public.accuracy_votes where review_id = new.review_id and vote = 'no')
  where id = new.review_id;
  return new;
end;
$$;

create trigger trg_update_vote_counts
  after insert on public.accuracy_votes
  for each row execute function public.update_review_vote_counts();

-- ── Trigger: recalculate profile peep_score & review_count after review insert
create or replace function public.recalculate_peep_score()
returns trigger language plpgsql security definer as $$
declare
  avg_score  numeric;
  r_count    integer;
begin
  select
    count(*),
    round(
      avg(
        (coalesce(rating_work_ethic,0) +
         coalesce(rating_reliability,0) +
         coalesce(rating_honesty,0) +
         coalesce(rating_character,0) +
         coalesce(rating_intelligence,0) +
         coalesce(rating_social_skills,0))::numeric
        / greatest(
            nullif(
              (case when rating_work_ethic    is not null then 1 else 0 end +
               case when rating_reliability   is not null then 1 else 0 end +
               case when rating_honesty       is not null then 1 else 0 end +
               case when rating_character     is not null then 1 else 0 end +
               case when rating_intelligence  is not null then 1 else 0 end +
               case when rating_social_skills is not null then 1 else 0 end), 0), 1)
        * 200  -- scale: avg of 5-star ratings × 200 = max 1000
      ) , 0
    )
  into r_count, avg_score
  from public.reviews
  where profile_id = new.profile_id;

  update public.profiles
  set
    peep_score   = least(1000, greatest(0, coalesce(avg_score, 0)::integer)),
    review_count = r_count
  where id = new.profile_id;

  return new;
end;
$$;

create trigger trg_recalculate_score
  after insert or update on public.reviews
  for each row execute function public.recalculate_peep_score();

-- ── Enable Realtime on key tables ─────────────────────────────────────────────
-- Run these in the Supabase dashboard Replication tab, or via:
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.reviews;
alter publication supabase_realtime add table public.accuracy_votes;

-- ── Social Connections ────────────────────────────────────────────────────────
-- Users must connect a social account with 500+ connections/followers
-- to write reviews OR to have their profile accept reviews.
create table if not exists public.social_connections (
  id              uuid primary key default uuid_generate_v4(),
  created_at      timestamptz not null default now(),
  profile_id      uuid references public.profiles(id) on delete cascade,
  platform        text not null check (platform in ('facebook', 'linkedin', 'instagram')),
  handle          text not null,
  follower_count  integer not null default 0 check (follower_count >= 0),
  is_verified     boolean not null generated always as (follower_count >= 500) stored,
  unique (profile_id, platform)
);

alter table public.social_connections enable row level security;

create policy "Social connections are publicly readable"
  on public.social_connections for select using (true);

create policy "Anyone can insert social connections"
  on public.social_connections for insert with check (true);

create policy "Anyone can update social connections"
  on public.social_connections for update using (true);

-- ── Seed demo data ────────────────────────────────────────────────────────────
insert into public.profiles (full_name, title, company, location, initials, avatar_class, peep_score, review_count, accuracy_rate, is_verified)
values
  ('Alex Morgan',   'Senior Product Designer', 'Vercel', 'San Francisco, CA', 'AM', 'avatar-1', 847, 42, 96.0, true),
  ('Priya Sharma',  'Software Engineer',       'Stripe', 'Austin, TX',        'PS', 'avatar-2', 912, 67, 98.0, true),
  ('Jordan Kim',    'Marketing Lead',          'Figma',  'New York, NY',      'JK', 'avatar-3', 723, 29, 88.0, false),
  ('Nadia Reeves',  'Finance Analyst',         'Goldman Sachs', 'Chicago, IL','NR', 'avatar-4', 881, 38, 93.0, true),
  ('Carlos Bravo',  'Founder',                 'Self',   'Miami, FL',         'CB', 'avatar-5', 604, 18, 81.0, false),
  ('Taylor Hayes',  'UX Researcher',           'Apple',  'Seattle, WA',       'TH', 'avatar-6', 778, 31, 91.0, false)
on conflict do nothing;
-- ── Waitlist ───────────────────────────────────────────────────────────────────
create table if not exists public.waitlist (
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
alter table public.waitlist enable row level security;
create policy "Anyone can join waitlist"
  on public.waitlist for insert with check (true);

-- ── Review Disputes ────────────────────────────────────────────────────────────
create table if not exists public.review_disputes (
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
alter table public.review_disputes enable row level security;
create policy "Authenticated users can submit disputes"
  on public.review_disputes for insert
  with check (auth.role() = 'authenticated');
create policy "Users can view their own disputes"
  on public.review_disputes for select
  using (auth.uid() = reporter_id);

-- ── Profile extra fields (safe to run on existing DBs) ───────────────────────
alter table public.profiles add column if not exists website      text;
alter table public.profiles add column if not exists industry     text;
alter table public.profiles add column if not exists linkedin_url text;