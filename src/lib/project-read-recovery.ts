/** A failed scoped read is not evidence that a signed-in member needs another code. */
export function projectReadRecovery(signedIn: boolean, error?: unknown): "sign-in" | "unavailable" {
  if (!signedIn) return "sign-in";
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; status?: unknown };
    // These identify a rejected/expired JWT, rather than a database read failure.
    if (e.status === 401 || e.code === "PGRST301" || e.code === "PGRST303") return "sign-in";
  }
  return "unavailable";
}
