-- Athena accounting Phase 7: licensed form field maps. Additive only. STAGED, NOT APPLIED.
-- Stores ONLY field ids and value keys; never the form, its text or its layout.
CREATE TABLE IF NOT EXISTS public.mcp_licensed_form_maps (
  company_id uuid NOT NULL REFERENCES public.mcp_companies(id) ON DELETE CASCADE,
  form text NOT NULL CHECK (form IN ('G702','G703')),
  edition text NOT NULL CHECK (edition ~ '^\d{4}$'),
  fields jsonb NOT NULL CHECK (jsonb_typeof(fields) = 'array'),
  saved_by uuid DEFAULT auth.uid(),
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, form, edition)
);
ALTER TABLE public.mcp_licensed_form_maps ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcp_licensed_form_maps_read ON public.mcp_licensed_form_maps FOR SELECT TO authenticated USING (public.mcp_is_company_member(company_id));

CREATE OR REPLACE FUNCTION public.mcp_form_map_save(_company uuid, _form text, _edition text, _fields jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.mcp_assert_active();
  IF NOT EXISTS (SELECT 1 FROM public.mcp_company_members WHERE company_id = _company AND user_id = auth.uid() AND role IN ('owner','all_access')) THEN
    RAISE EXCEPTION 'MCP_BAD:Only the owner or an all-access member can save a form map.';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(_fields) f WHERE length(f->>'field_id') > 64 OR (f - 'field_id' - 'value') <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'MCP_BAD:A form map holds only field ids and value keys.';
  END IF;
  INSERT INTO public.mcp_licensed_form_maps (company_id, form, edition, fields) VALUES (_company, _form, _edition, _fields)
  ON CONFLICT (company_id, form, edition) DO UPDATE SET fields = excluded.fields, saved_by = auth.uid(), saved_at = now();
END $$;
REVOKE EXECUTE ON FUNCTION public.mcp_form_map_save(uuid, text, text, jsonb) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.mcp_form_map_save(uuid, text, text, jsonb) TO authenticated;
