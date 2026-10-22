import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { readStoredAthenaSession } from "@/integrations/supabase/persistent-auth-storage";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const stored = readStoredAthenaSession();
    if (stored?.access_token && stored.user?.id) {
      setSession(stored as Session);
      setUser(stored.user as User);
      setLoading(false);
    }
    const timeoutId = window.setTimeout(() => {
      if (alive) setLoading(false);
    }, stored?.access_token ? 12_000 : 2500);

    let confirmed = false;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (!alive) return;
      if (!s && stored?.access_token && !confirmed) return;
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        confirmed = true;
        window.clearTimeout(timeoutId);
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        window.clearTimeout(timeoutId);
        setSession(null);
        setUser(null);
        setLoading(false);
      });
    return () => {
      alive = false;
      window.clearTimeout(timeoutId);
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user, loading, signOut: () => supabase.auth.signOut() };
}
