
-- Create private storage bucket for template files (PDFs, decks)
INSERT INTO storage.buckets (id, name, public)
VALUES ('template-files', 'template-files', false)
ON CONFLICT (id) DO NOTHING;

-- Admins can do anything in the bucket
CREATE POLICY "admins manage template-files"
ON storage.objects
FOR ALL
TO authenticated
USING (bucket_id = 'template-files' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'template-files' AND public.has_role(auth.uid(), 'admin'));

-- Active members can read template files (signed-URL access also works via service role)
CREATE POLICY "active members read template-files"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'template-files' AND public.has_active_access(auth.uid()));
