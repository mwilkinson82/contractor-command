// Source of truth for the current user's portal access tier.
// Reads `get_user_tier(uid)` from the DB so tier logic lives in one place.
// Admins always resolve to 'circle'.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type Tier = "aos_only" | "book_buyer" | "intensive" | "circle";

const RANK: Record<Tier, number> = {
  aos_only: 0,
  book_buyer: 1,
  intensive: 2,
  circle: 3,
};

export function tierAtLeast(actual: Tier | null, min: Tier): boolean {
  if (!actual) return false;
  return RANK[actual] >= RANK[min];
}

export function useTier() {
  const { user, loading: authLoading } = useAuth();
  const [tier, setTier] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;
    if (!user) {
      setTier(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .rpc("get_user_tier", { _user_id: user.id })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("get_user_tier failed", error);
          setTier(null);
        } else {
          setTier((data as Tier | null) ?? null);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return {
    tier,
    loading: loading || authLoading,
    isAosOnly: tier === "aos_only",
    isBookBuyer: tier === "book_buyer",
    isIntensive: tier === "intensive",
    isCircle: tier === "circle",
    hasAtLeast: (min: Tier) => tierAtLeast(tier, min),
  };
}
