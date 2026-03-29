-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: persistent unique profile slugs
--
-- WHY: Public profile URLs were resolving by normalizing full_name in the
-- client, which becomes ambiguous as soon as multiple people share the same
-- or similar names. This migration adds a real unique slug column and keeps it
-- synchronized whenever profiles are created or renamed.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.slugify_profile_name(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    nullif(regexp_replace(lower(unaccent(coalesce(value, ''))), '[^a-z0-9]+', '', 'g'), ''),
    'profile'
  );
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slug text;

CREATE OR REPLACE FUNCTION public.generate_unique_profile_slug(base_value text, current_profile_id uuid default null)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  base_slug text := public.slugify_profile_name(base_value);
  candidate text := base_slug;
  suffix integer := 2;
BEGIN
  WHILE EXISTS (
    SELECT 1
    FROM public.profiles profile_row
    WHERE profile_row.slug = candidate
      AND (current_profile_id IS NULL OR profile_row.id <> current_profile_id)
  ) LOOP
    candidate := base_slug || suffix::text;
    suffix := suffix + 1;
  END LOOP;

  RETURN candidate;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_profile_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.slug IS NULL
     OR NEW.slug = ''
     OR TG_OP = 'INSERT'
     OR NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    NEW.slug := public.generate_unique_profile_slug(NEW.full_name, NEW.id);
  ELSE
    NEW.slug := public.slugify_profile_name(NEW.slug);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_profile_slug ON public.profiles;
CREATE TRIGGER trg_set_profile_slug
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_profile_slug();

DO $$
DECLARE
  profile_row record;
BEGIN
  FOR profile_row IN
    SELECT id, full_name
    FROM public.profiles
    ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE public.profiles
    SET slug = public.generate_unique_profile_slug(profile_row.full_name, profile_row.id)
    WHERE id = profile_row.id;
  END LOOP;
END $$;

UPDATE public.profiles
SET slug = public.generate_unique_profile_slug(full_name, id)
WHERE slug IS NULL OR slug = '';

ALTER TABLE public.profiles
  ALTER COLUMN slug SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_slug_format_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_slug_format_check
      CHECK (slug ~ '^[a-z0-9]+$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_slug_key'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_slug_key UNIQUE (slug);
  END IF;
END $$;