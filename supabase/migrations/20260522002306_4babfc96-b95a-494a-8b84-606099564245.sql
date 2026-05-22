
-- Cleanup duplicates per user direction
-- 1) Preston: keep barcconstruction.com, drop barcbuildergroup.com (no sub, never claimed)
DELETE FROM public.subscriptions WHERE lower(email) = 'preston@barcbuildergroup.com';
DELETE FROM public.profiles WHERE lower(email) = 'preston@barcbuildergroup.com';

-- 2) Andy: keep ajhoover@mac.com (hardcore, has stripe_customer_id), drop andy.j.ramirez@outlook.com duplicate
DELETE FROM public.subscriptions WHERE lower(email) = 'andy.j.ramirez@outlook.com';
DELETE FROM public.profiles WHERE lower(email) = 'andy.j.ramirez@outlook.com';
