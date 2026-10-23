// Single source of truth for the user's company record.
// Lives client-side: RLS scopes the row to the owner automatically.
//
// One company per user (v1). The schema (companies.owner_user_id UNIQUE)
// keeps the door open for a company_members join table later without
// requiring every reader to change.

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { companyTabTitle } from "@/lib/host-document";
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
  const userId = user?.id ?? null;
  const request = useRef(0);
  const [result, setResult] = useState<{
    userId: string | null;
    status: "idle" | "loading" | "ready" | "error";
    company: Company | null;
  }>({ userId: null, status: "idle", company: null });

  const load = useCallback(async () => {
    const currentRequest = ++request.current;
    if (!userId) {
      setResult({ userId: null, status: "idle", company: null });
      return;
    }
    setResult({ userId, status: "loading", company: null });
    try {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .eq("owner_user_id", userId)
        .maybeSingle();
      if (request.current !== currentRequest) return;
      setResult({
        userId,
        status: error ? "error" : "ready",
        company: error ? null : ((data as Company) ?? null),
      });
    } catch {
      if (request.current === currentRequest) {
        setResult({ userId, status: "error", company: null });
      }
    }
  }, [userId]);

  useEffect(() => {
    if (authLoading) return;
    void load();
    const pendingRequests = request;
    return () => {
      pendingRequests.current++;
    };
  }, [authLoading, load]);

  // An identity can change before its loading effect runs. Never use the
  // previous identity's result (including "no company") during that render.
  const current = result.userId === userId;
  const ready = current && result.status === "ready";
  const company = ready ? result.company : null;
  const loading =
    authLoading ||
    (!!userId && (!current || result.status === "idle" || result.status === "loading"));
  const error =
    current && result.status === "error" ? "Could not load your company. Please try again." : null;

  // Hub tabs follow the company. Athena keeps the host document title.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const host = typeof window === "undefined" ? "" : window.location.hostname;
    const title = companyTabTitle(host, company?.name);
    if (title) document.title = title;
  }, [company?.name]);

  const logoUrl = logoPublicUrl(company?.logo_path);
  const needsOnboarding = !authLoading && !!userId && ready && (!company || !company.name?.trim());

  return { company, logoUrl, loading, error, needsOnboarding, refetch: load };
}
