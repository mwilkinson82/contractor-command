
CREATE TABLE public.email_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL UNIQUE,
  template_name text NOT NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  html text NOT NULL,
  plain_text text NOT NULL,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL,
  unsubscribe_token text NOT NULL,
  from_address text NOT NULL,
  sender_domain text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_email text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_approvals_status_created_at_idx
  ON public.email_approvals (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_approvals TO authenticated;
GRANT ALL ON public.email_approvals TO service_role;

ALTER TABLE public.email_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage email approvals"
  ON public.email_approvals
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER email_approvals_updated_at
  BEFORE UPDATE ON public.email_approvals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
