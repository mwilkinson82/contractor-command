import type { SupabaseClient } from "@supabase/supabase-js";

export type CircleDecision = {
  state: "eligible" | "ineligible" | "review";
  hasAccess: boolean;
  reason: string;
};
export type CircleIdentity = {
  email: string;
  userId: string | null;
  firstName: string | null;
  lastName?: string | null;
  company?: string | null;
};
// New service-only schema is deliberately isolated until Lovable regenerates types.
export const membershipDb = (db: unknown): SupabaseClient => db as SupabaseClient;

export async function circleDecision(
  db: unknown,
  identity: { userId?: string | null; email: string },
): Promise<CircleDecision> {
  const { data, error } = await membershipDb(db).rpc("get_circle_entitlement", {
    _user_id: identity.userId ?? null,
    _email: identity.email.trim().toLowerCase(),
  });
  if (error) throw new Error(`Circle entitlement lookup failed: ${error.message}`);
  if (
    !data ||
    !["eligible", "ineligible", "review"].includes(data.state) ||
    typeof data.hasAccess !== "boolean"
  ) {
    throw new Error("Invalid Circle entitlement result");
  }
  return data as CircleDecision;
}

async function allRows(
  db: unknown,
  table: string,
  columns: string,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await membershipDb(db)
      .from(table)
      .select(columns)
      .order("id")
      .range(offset, offset + 499);
    if (error) throw new Error(`Circle ${table} lookup failed: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if ((data ?? []).length < 500) return rows;
  }
}

/** Includes paid-but-unclaimed and grant-only people; one preferred email per linked account. */
export async function loadCircleIdentities(db: unknown): Promise<CircleIdentity[]> {
  const [profiles, subscriptions, grants] = await Promise.all([
    allRows(db, "profiles", "id,email,full_name"),
    allRows(db, "subscriptions", "id,user_id,email,tier,metadata"),
    allRows(db, "circle_owner_grants", "id,user_id,email"),
  ]);
  const profilesById = new Map(profiles.map((p) => [p.id, p]));
  const byEmail = new Map<string, CircleIdentity>();
  for (const row of [
    ...subscriptions.filter((s) => ["circle", "hardcore"].includes(String(s.tier))),
    ...grants,
  ]) {
    const linked = profilesById.get(row.user_id ?? row.id);
    const email = String(linked?.email ?? row.email ?? "")
      .trim()
      .toLowerCase();
    if (!email) continue;
    const userId = String(linked?.id ?? row.user_id ?? "") || null;
    const prior = byEmail.get(email);
    if (prior?.userId && userId && prior.userId !== userId)
      throw new Error(`Circle identity requires review: ${email}`);
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    byEmail.set(email, {
      email,
      userId: userId ?? prior?.userId ?? null,
      company: typeof metadata.company === "string" ? metadata.company : prior?.company,
      lastName:
        String(linked?.full_name ?? "")
          .trim()
          .split(/\s+/)
          .slice(1)
          .join(" ") || prior?.lastName,
      firstName:
        String(linked?.full_name ?? metadata.first_name ?? "")
          .trim()
          .split(/\s+/)[0] || null,
    });
  }
  return [...byEmail.values()];
}

export async function loadCircleAudience(db: unknown): Promise<CircleIdentity[]> {
  const recipients: CircleIdentity[] = [];
  const review: string[] = [];
  for (const identity of await loadCircleIdentities(db)) {
    const decision = await circleDecision(db, identity);
    if (decision.state === "review") review.push(identity.email);
    if (decision.state === "eligible") recipients.push(identity);
  }
  if (review.length)
    throw new Error(
      `Circle audience requires membership review (${review.length} identities). Run the reconciliation preview.`,
    );
  return recipients;
}
