
CREATE TABLE public.member_announcements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  announcement_id UUID,
  sent_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  audience TEXT NOT NULL,
  subject TEXT NOT NULL,
  headline TEXT NOT NULL,
  preheader TEXT,
  body TEXT NOT NULL,
  cta_label TEXT,
  cta_url TEXT,
  signoff TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  was_test BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.member_announcements TO authenticated;
GRANT ALL ON public.member_announcements TO service_role;

ALTER TABLE public.member_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read member announcements"
  ON public.member_announcements FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can insert member announcements"
  ON public.member_announcements FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX member_announcements_created_at_idx
  ON public.member_announcements (created_at DESC);
