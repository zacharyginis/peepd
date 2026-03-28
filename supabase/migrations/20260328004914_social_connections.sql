-- Social Connections
-- Users must connect a social account with 500+ connections/followers
-- to write reviews OR to have their profile accept reviews.
create table if not exists public.social_connections (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  profile_id      uuid references public.profiles(id) on delete cascade,
  platform        text not null check (platform in ('facebook', 'linkedin', 'instagram')),
  handle          text not null,
  follower_count  integer not null default 0 check (follower_count >= 0),
  is_verified     boolean not null default false,
  unique (profile_id, platform)
);

create or replace function public.set_social_verified()
returns trigger language plpgsql as $$
begin
  new.is_verified := new.follower_count >= 500;
  return new;
end;
$$;

create trigger trg_set_social_verified
  before insert or update on public.social_connections
  for each row execute function public.set_social_verified();

alter table public.social_connections enable row level security;

create policy "Social connections are publicly readable"
  on public.social_connections for select using (true);

create policy "Anyone can insert social connections"
  on public.social_connections for insert with check (true);

create policy "Anyone can update social connections"
  on public.social_connections for update using (true);
