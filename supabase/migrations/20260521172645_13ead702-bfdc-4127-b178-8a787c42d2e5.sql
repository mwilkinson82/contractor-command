DROP POLICY IF EXISTS "circle members read replays" ON public.replays;
CREATE POLICY "book buyers and up read replays"
  ON public.replays FOR SELECT
  USING (published AND public.has_tier_at_least(auth.uid(), 'book_buyer'::public.app_tier));