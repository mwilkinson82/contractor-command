// Admin-only visual tier override. Stored in sessionStorage so it dies with
// the tab and never persists. RLS still applies to the real admin user —
// this only swaps which UI/gates the admin sees.

import type { Tier } from "@/hooks/use-tier";

const KEY = "alp.cc.impersonatedTier";
const EVENT = "alp:impersonated-tier-change";

export function getImpersonatedTier(): Tier | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.sessionStorage.getItem(KEY);
    return (v as Tier | null) || null;
  } catch {
    return null;
  }
}

export function setImpersonatedTier(tier: Tier | null) {
  if (typeof window === "undefined") return;
  try {
    if (tier) window.sessionStorage.setItem(KEY, tier);
    else window.sessionStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function subscribeImpersonatedTier(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
