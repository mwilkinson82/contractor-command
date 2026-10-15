// Decides when a Supabase auth event should refresh the router. Runs the
// refresh outside the auth callback (the auth client holds its lock while
// notifying listeners) and never restarts the public sign-in / consent flow.
export const AUTH_FLOW_PATHS = new Set(["/login", "/auth/callback", "/oauth/consent"]);

export function shouldInvalidateOnAuthEvent(event: string, pathname: string): boolean {
  if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return false;
  if (AUTH_FLOW_PATHS.has(pathname)) return false;
  return event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED";
}

export function createAuthInvalidationScheduler(opts: {
  getPathname: () => string;
  invalidate: () => unknown;
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void;
}) {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));
  let pending: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  return {
    onEvent(event: string) {
      if (disposed || pending !== undefined) return;
      if (!shouldInvalidateOnAuthEvent(event, opts.getPathname())) return;
      pending = setTimer(() => {
        pending = undefined;
        // Re-check the current path when the timer fires, not the one captured
        // when the event arrived.
        if (disposed || !shouldInvalidateOnAuthEvent(event, opts.getPathname())) return;
        void opts.invalidate();
      }, 0);
    },
    dispose() {
      disposed = true;
      if (pending !== undefined) clearTimer(pending);
      pending = undefined;
    },
  };
}
