// AOS allowance for the current user. -1 means unlimited.
// Reads `get_user_aos_limits(uid)` so the rule lives in one place (DB).
//
// Used by:
//   - /aos gate: show the button only when seat_limit > 0 (or -1)
//   - /aos page: render "1 workspace · 2 seats — upgrade for more"
//   - /aos/seats: render the upgrade ladder
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { Tier } from "@/hooks/use-tier";

export type AosLimits = {
  tier: Tier | "aos_only" | null;
  workspaceLimit: number; // -1 = unlimited, 0 = no access
  seatLimit: number;
};

export function useAosLimits() {
  const { user, loading: authLoading } = useAuth();
  const [limits, setLimits] = useState<AosLimits | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (authLoading) return;
    if (!user) {
      setLimits(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .rpc("get_user_aos_limits", { _user_id: user.id })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("get_user_aos_limits failed", error);
          setLimits(null);
        } else {
          const row = Array.isArray(data) ? data[0] : data;
          if (row) {
            setLimits({
              tier: row.tier ?? null,
              workspaceLimit: row.workspace_limit ?? 0,
              seatLimit: row.seat_limit ?? 0,
            });
          } else {
            setLimits({ tier: null, workspaceLimit: 0, seatLimit: 0 });
          }
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const hasAccess = !!limits && limits.seatLimit !== 0;
  const isUnlimited = !!limits && limits.seatLimit === -1;

  return {
    limits,
    loading: loading || authLoading,
    hasAccess,
    isUnlimited,
  };
}
