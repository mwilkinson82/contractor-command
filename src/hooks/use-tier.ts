// Source of truth for the current user's portal access tier.
// Reads `get_user_tier(uid)` from the DB so tier logic lives in one place.
// Admins always resolve to 'circle'.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  getImpersonatedTier,
  subscribeImpersonatedTier,
} from "@/lib/tier-impersonation";

export type Tier =
  | "aos_only"
  | "book_buyer"
  | "power_hour"
  | "sm_school"
  | "contractor_school"
  | "intensive"
  | "circle"
  | "hardcore";

// Rank-based gates. power_hour, sm_school, contractor_school share rank 2 —
// they unlock the same surfaces but different replay shelves.
const RANK: Record<Tier, number> = {
  aos_only: 0,
  book_buyer: 1,
  power_hour: 2,
  sm_school: 2,
  contractor_school: 2,
  intensive: 3,
  circle: 4,
  hardcore: 5,
};

export function tierAtLeast(actual: Tier | null, min: Tier): boolean {
  if (!actual) return false;
  return RANK[actual] >= RANK[min];
}

export function useTier() {
  const { user, loading: authLoading } = useAuth();
  const [realTier, setRealTier] = useState<Tier | null>(null);
  const [loading, setLoading] = useState(true);
  const [override, setOverride] = useState<Tier | null>(() => getImpersonatedTier());

  useEffect(() => {
    const unsub = subscribeImpersonatedTier(() => setOverride(getImpersonatedTier()));
    return unsub;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;
    if (!user) {
      setRealTier(null);
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
          setRealTier(null);
        } else {
          setRealTier((data as Tier | null) ?? null);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const tier = override ?? realTier;

  return {
    tier,
    realTier,
    impersonating: override !== null,
    loading: loading || authLoading,
    isAosOnly: tier === "aos_only",
    isBookBuyer: tier === "book_buyer",
    isPowerHour: tier === "power_hour",
    isSmSchool: tier === "sm_school",
    isIntensive: tier === "intensive",
    isCircle: tier === "circle",
    isHardcore: tier === "hardcore",
    hasAtLeast: (min: Tier) => tierAtLeast(tier, min),
  };
}
