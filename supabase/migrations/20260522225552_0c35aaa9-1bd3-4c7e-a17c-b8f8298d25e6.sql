-- Phase 0: Project metadata + membership scaffolding

-- Project status enum
DO $$ BEGIN
  CREATE TYPE public.schedule_status AS ENUM ('planning', 'active', 'on_hold', 'closed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add first-class fields to schedules
ALTER TABLE public.schedules
  ADD COLUMN IF NOT EXISTS client text,
  ADD COLUMN IF NOT EXISTS project_number text,
  ADD COLUMN IF NOT EXISTS status public.schedule_status NOT NULL DEFAULT 'planning',
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cover_color text;

-- Member role enum
DO $$ BEGIN
  CREATE TYPE public.schedule_member_role AS ENUM ('owner', 'scheduler', 'viewer');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- project_members table
CREATE TABLE IF NOT EXISTS public.schedule_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.schedules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.schedule_member_role NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, user_id)
);

ALTER TABLE public.schedule_members ENABLE ROW LEVEL SECURITY;

-- Security-definer helper: is the user a member (or owner) of a schedule?
CREATE OR REPLACE FUNCTION public.is_schedule_member(_schedule_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.schedules s
    WHERE s.id = _schedule_id AND s.user_id = _user_id
  ) OR EXISTS (
    SELECT 1 FROM public.schedule_members m
    WHERE m.schedule_id = _schedule_id AND m.user_id = _user_id
  );
$$;

-- RLS for schedule_members
DROP POLICY IF EXISTS "admin manages schedule members" ON public.schedule_members;
CREATE POLICY "admin manages schedule members"
  ON public.schedule_members FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "owner manages schedule members" ON public.schedule_members;
CREATE POLICY "owner manages schedule members"
  ON public.schedule_members FOR ALL
  USING (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_members.schedule_id AND s.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.schedules s WHERE s.id = schedule_members.schedule_id AND s.user_id = auth.uid()));

DROP POLICY IF EXISTS "members read own membership" ON public.schedule_members;
CREATE POLICY "members read own membership"
  ON public.schedule_members FOR SELECT
  USING (auth.uid() = user_id);

-- Index for filtering
CREATE INDEX IF NOT EXISTS schedules_user_status_idx ON public.schedules (user_id, status);
CREATE INDEX IF NOT EXISTS schedule_members_user_idx ON public.schedule_members (user_id);
