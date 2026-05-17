// Single source of truth for the user's company record.
// Lives client-side: RLS scopes the row to the owner automatically.
//
// One company per user (v1). The schema (companies.owner_user_id UNIQUE)
// keeps the door open for a company_members join table later without
// requiring every reader to change.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type Company = {
  id: string;
  owner_user_id: string;
  name: string;
  address: string | null;
  logo_path: string | null;
  greeting_icon: string | null;
  created_at: string;
  updated_at: string;
};

const BUCKET = "company-logos";

export function logoPublicUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl ?? null;
}

export function useCompany() {
  const { user, loading: authLoading } = useAuth();
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      setCompany(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("companies")
      .select("*")
      .eq("owner_user_id", user.id)
      .maybeSingle();
    if (!error) setCompany((data as Company) ?? null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  // Keep the browser tab title aligned with the company.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (company?.name?.trim()) {
      document.title = `${company.name} · Command Center`;
    }
  }, [company?.name]);

  const logoUrl = logoPublicUrl(company?.logo_path);
  const needsOnboarding =
    !authLoading && !loading && !!user && (!company || !company.name?.trim());

  return { company, logoUrl, loading: authLoading || loading, needsOnboarding, refetch: load };
}
