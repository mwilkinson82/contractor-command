
-- 1. Extend app_tier enum with new tiers
ALTER TYPE public.app_tier ADD VALUE IF NOT EXISTS 'power_hour';
ALTER TYPE public.app_tier ADD VALUE IF NOT EXISTS 'sm_school';
ALTER TYPE public.app_tier ADD VALUE IF NOT EXISTS 'hardcore';
