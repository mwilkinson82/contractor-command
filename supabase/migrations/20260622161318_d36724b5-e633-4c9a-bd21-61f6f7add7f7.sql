
CREATE TABLE public.weekly_moves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  headline text NOT NULL,
  body text NOT NULL,
  cta_label text NOT NULL,
  cta_to text,
  cta_href text,
  source text,
  active_from timestamptz NOT NULL DEFAULT now(),
  active_to timestamptz,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_moves_cta_one_of CHECK (
    (cta_to IS NOT NULL AND cta_href IS NULL)
    OR (cta_to IS NULL AND cta_href IS NOT NULL)
    OR (cta_to IS NULL AND cta_href IS NULL)
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_moves TO authenticated;
GRANT ALL ON public.weekly_moves TO service_role;

ALTER TABLE public.weekly_moves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read active weekly moves"
  ON public.weekly_moves
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR (
      active_from <= now()
      AND (active_to IS NULL OR active_to > now())
    )
  );

CREATE POLICY "Admins can write weekly moves"
  ON public.weekly_moves
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER weekly_moves_set_updated_at
  BEFORE UPDATE ON public.weekly_moves
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX weekly_moves_active_from_idx
  ON public.weekly_moves (active_from DESC);
