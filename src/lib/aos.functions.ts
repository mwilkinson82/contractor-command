import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createHmac } from "crypto";

export type AosMeasurable = {
  id: string;
  name: string;
  unit?: string | null;
  goal?: number | null;
  weeks: { week_start: string; value: number | null }[];
};

export type AosRock = {
  id: string;
  title: string;
  owner?: string | null;
  status: "on-track" | "off-track" | "done" | "unknown";
  percent_complete: number;
  due_date?: string | null;
};

export type AosTodo = {
  id: string;
  title: string;
  due_date?: string | null;
  owner?: string | null;
};

export type AosIssue = {
  id: string;
  title: string;
  created_at: string;
  owner?: string | null;
};

export type AosCompany = { id: string; name: string };

export type AosScorecardSummary = {
  metrics_count: number;
  on_goal_this_week: number;
  off_goal_this_week: number;
  week_ending: string | null;
};

export type AosPulseCounts = {
  rocks?: { total: number; on_track: number; off_track: number; done: number };
  issues?: { open: number };
  todos?: { open: number; overdue: number };
};

export type AosSnapshot =
  | {
      linked: true;
      company_id: string | null;
      company_name: string | null;
      companies: AosCompany[];
      last_login_at: string | null;
      next_meeting: { date: string; kind: string } | null;
      scorecard: AosMeasurable[];
      scorecard_summary?: AosScorecardSummary;
      pulse_counts?: AosPulseCounts;
      rocks: AosRock[];
      issues_open: AosIssue[];
      todos_due_this_week: AosTodo[];
    }
  | { linked: false; reason: string; companies?: AosCompany[] };

export type AosResult =
  | { ok: true; snapshot: AosSnapshot; fetched_at: string; previously_linked: boolean }
  | { ok: false; error: string };

function secretVariants(secret: string) {
  return Array.from(new Set([secret, secret.trim()]));
}

function snapshotSigningStrings({
  email,
  ts,
  nonce,
  tier,
  workspaceLimit,
  seatLimit,
}: {
  email: string;
  ts: number | string;
  nonce: string;
  tier: string;
  workspaceLimit: number;
  seatLimit: number;
}) {
  return Array.from(
    new Set([
      `${email}|${ts}|${nonce}|${tier}|${workspaceLimit}|${seatLimit}`,
      `${email}|${ts}|${nonce}`,
    ]),
  );
}

function normalizeAosSnapshot(raw: unknown, email: string): AosSnapshot {
  const snapshot = raw as Partial<Extract<AosSnapshot, { linked: true }>> & {
    linked?: boolean;
    exists?: boolean;
    workspace_count?: number;
    primary_workspace_name?: string | null;
    primary_workspace_id?: string | null;
    companies?: AosCompany[];
    workspaces?: Array<{ id: string; name: string }>;
    pulse?: {
      company_id?: string | null;
      company_name?: string | null;
      rocks?: AosPulseCounts["rocks"] & { list?: Array<{ id: string; title: string; owner?: string | null; status?: string | null; progress?: number | null; due_date?: string | null }> };
      issues?: AosPulseCounts["issues"] & { list?: Array<{ id: string; title: string; owner?: string | null; created_at?: string | null }> };
      todos?: AosPulseCounts["todos"] & { list?: Array<{ id: string; title: string; owner?: string | null; due_date?: string | null }> };
      scorecard?: AosScorecardSummary;
    };
  };

  // Coalesce workspaces[] (AOS naming) into companies[] (Circle naming).
  const rawList = Array.isArray(snapshot.workspaces)
    ? snapshot.workspaces
    : Array.isArray(snapshot.companies)
      ? snapshot.companies
      : [];
  const companies: AosCompany[] = rawList
    .filter((w): w is { id: string; name: string } => !!w && typeof w.id === "string" && typeof w.name === "string")
    .map((w) => ({ id: w.id, name: w.name }));

  if (typeof snapshot.linked === "boolean") {
    if (!snapshot.linked) return snapshot as AosSnapshot;

    const pulse = snapshot.pulse;
    const normalizedRocks: AosRock[] = Array.isArray(pulse?.rocks?.list)
      ? pulse.rocks.list.map((r) => ({
          id: r.id,
          title: r.title,
          owner: r.owner ?? null,
          status:
            r.status === "on_track"
              ? "on-track"
              : r.status === "off_track"
                ? "off-track"
                : r.status === "done"
                  ? "done"
                  : "unknown",
          percent_complete: r.progress ?? 0,
          due_date: r.due_date ?? null,
        }))
      : (snapshot.rocks ?? []);

    const normalizedIssues: AosIssue[] = Array.isArray(pulse?.issues?.list)
      ? pulse.issues.list.map((i) => ({
          id: i.id,
          title: i.title,
          owner: i.owner ?? null,
          created_at: i.created_at ?? new Date().toISOString(),
        }))
      : (snapshot.issues_open ?? []);

    const normalizedTodos: AosTodo[] = Array.isArray(pulse?.todos?.list)
      ? pulse.todos.list.map((t) => ({
          id: t.id,
          title: t.title,
          owner: t.owner ?? null,
          due_date: t.due_date ?? null,
        }))
      : (snapshot.todos_due_this_week ?? []);

    return {
      linked: true,
      company_id: pulse?.company_id ?? snapshot.company_id ?? snapshot.primary_workspace_id ?? companies[0]?.id ?? null,
      company_name: pulse?.company_name ?? snapshot.company_name ?? snapshot.primary_workspace_name ?? companies[0]?.name ?? null,
      companies: companies.length ? companies : (snapshot.companies ?? []),
      last_login_at: snapshot.last_login_at ?? null,
      next_meeting: snapshot.next_meeting ?? null,
      scorecard: snapshot.scorecard ?? [],
      scorecard_summary: pulse?.scorecard ?? snapshot.scorecard_summary,
      pulse_counts: pulse
        ? {
            rocks: pulse.rocks
              ? {
                  total: pulse.rocks.total ?? normalizedRocks.length,
                  on_track: pulse.rocks.on_track ?? normalizedRocks.filter((r) => r.status === "on-track").length,
                  off_track: pulse.rocks.off_track ?? normalizedRocks.filter((r) => r.status === "off-track").length,
                  done: pulse.rocks.done ?? normalizedRocks.filter((r) => r.status === "done").length,
                }
              : undefined,
            issues: pulse.issues ? { open: pulse.issues.open ?? normalizedIssues.length } : undefined,
            todos: pulse.todos
              ? {
                  open: pulse.todos.open ?? normalizedTodos.length,
                  overdue:
                    pulse.todos.overdue ??
                    normalizedTodos.filter((t) => t.due_date && new Date(t.due_date) < new Date()).length,
                }
              : undefined,
          }
        : snapshot.pulse_counts,
      rocks: normalizedRocks,
      issues_open: normalizedIssues,
      todos_due_this_week: normalizedTodos,
    };
  }

  // Lightweight account probe: { exists, workspace_count, primary_workspace_name, workspaces? }.
  if (snapshot.exists) {
    return {
      linked: true,
      company_id: snapshot.primary_workspace_id ?? companies[0]?.id ?? null,
      company_name: snapshot.primary_workspace_name ?? companies[0]?.name ?? null,
      companies,
      last_login_at: null,
      next_meeting: null,
      scorecard: [],
      rocks: [],
      issues_open: [],
      todos_due_this_week: [],
    };
  }

  return {
    linked: false,
    reason: `No AOS workspace found yet for ${email}. Open AOS once, then come back and check again.`,
  };
}

export const getAosSnapshot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { companyId?: string } | undefined) => input ?? {})
  .handler(async ({ data, context }): Promise<AosResult> => {
    const baseUrl = process.env.AOS_BASE_URL;
    const secret = process.env.AOS_SHARED_SECRET;
    if (!baseUrl || !secret) {
      return { ok: false, error: "AOS link not configured on Circle." };
    }

    // Pull email from the verified Supabase claims
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    if (!email) {
      return { ok: false, error: "No email on your account." };
    }

    const ts = Math.floor(Date.now() / 1000);
    const normalizedEmail = email.toLowerCase().trim();
    const { supabase, userId } = context;
    const { data: limitsRows } = await supabase.rpc("get_user_aos_limits", {
      _user_id: userId,
    });
    const limitsRow = Array.isArray(limitsRows) ? limitsRows[0] : limitsRows;
    const tier = (limitsRow?.tier as string | null) ?? "";
    const workspaceLimit = (limitsRow?.workspace_limit as number | null) ?? 0;
    const seatLimit = (limitsRow?.seat_limit as number | null) ?? 0;
    const { data: existingLink } = await supabase
      .from("aos_links")
      .select("aos_email, verified_at")
      .eq("user_id", userId)
      .maybeSingle();
    const snapshotEmail = (existingLink?.aos_email ?? normalizedEmail).toLowerCase().trim();

    try {
      let res: Response | null = null;
      for (const signingSecret of secretVariants(secret)) {
        const nonce =
          Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
        for (const signingString of snapshotSigningStrings({
          email: snapshotEmail,
          ts,
          nonce,
          tier,
          workspaceLimit,
          seatLimit,
        })) {
          const sig = createHmac("sha256", signingSecret).update(signingString).digest("hex");

          res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/public/circle/snapshot`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-circle-signature": sig,
              "x-circle-ts": String(ts),
              "x-circle-nonce": nonce,
            },
            redirect: "manual",
            body: JSON.stringify({
              email: snapshotEmail,
              ts,
              nonce,
              sig,
              tier,
              workspace_limit: workspaceLimit,
              seat_limit: seatLimit,
              company_id: data.companyId ?? null,
            }),
          });

          if (res.ok) break;
          const text = await res
            .clone()
            .text()
            .catch(() => "");
          if (!text.includes("Bad signature")) break;
        }

        if (res?.ok || signingSecret === secret.trim()) break;
      }

      if (!res) {
        return { ok: false, error: "Could not reach AOS." };
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("AOS snapshot returned non-OK", {
          status: res.status,
          body: text.slice(0, 300),
          email: snapshotEmail,
        });
        return {
          ok: false,
          error: `AOS returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
        };
      }

      const snapshot = normalizeAosSnapshot(await res.json(), snapshotEmail);
      const previously_linked = Boolean(existingLink?.verified_at);

      // Persist the link the first time we confirm it (and refresh last_sync_at)
      if (snapshot.linked) {
        await supabase.from("aos_links").upsert(
          {
            user_id: userId,
            aos_email: snapshotEmail,
            verified_at: existingLink?.verified_at ?? new Date().toISOString(),
            last_sync_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
      }

      return {
        ok: true,
        snapshot,
        fetched_at: new Date().toISOString(),
        previously_linked: previously_linked || snapshot.linked,
      };
    } catch (err) {
      console.error("AOS snapshot fetch failed:", err);
      return { ok: false, error: "Could not reach AOS." };
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// SSO handoff: mint a short-lived signed token, return a URL that AOS will
// consume to sign the user in (find-or-create by email). AOS side lives at
// `/api/public/circle/sso` on the AOS project and verifies the same HMAC.
//
// Token shape: `${email}.${ts}.${nonce}.${sig}` (URL-safe).
// Signing string: `${email}|${ts}|${nonce}`.
// TTL enforced on the AOS side (60s recommended).
// ─────────────────────────────────────────────────────────────────────────────

export type AosSsoMint =
  | {
      ok: true;
      url: string;
      aos_email: string;
      previously_linked: boolean;
      tier: string | null;
      workspace_limit: number;
      seat_limit: number;
    }
  | { ok: false; error: string };

export const mintAosSsoToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AosSsoMint> => {
    const baseUrl = process.env.AOS_BASE_URL;
    const secret = process.env.AOS_SHARED_SECRET;
    if (!baseUrl || !secret) {
      return { ok: false, error: "AOS link not configured on Circle." };
    }

    const claimEmail = (context.claims as { email?: string } | null)?.email ?? null;
    if (!claimEmail) {
      return { ok: false, error: "No email on your account." };
    }

    // If the member previously linked a different AOS email, use that.
    const { supabase, userId } = context;
    const { data: link } = await supabase
      .from("aos_links")
      .select("aos_email, verified_at")
      .eq("user_id", userId)
      .maybeSingle();

    // Pull the user's effective AOS allowance. Circle is the source of truth
    // for tier + limits; AOS verifies the HMAC and trusts these numbers.
    const { data: limitsRows } = await supabase.rpc("get_user_aos_limits", {
      _user_id: userId,
    });
    const limitsRow = Array.isArray(limitsRows) ? limitsRows[0] : limitsRows;
    const tier = (limitsRow?.tier as string | null) ?? null;
    const workspaceLimit = (limitsRow?.workspace_limit as number | null) ?? 0;
    const seatLimit = (limitsRow?.seat_limit as number | null) ?? 0;

    const email = (link?.aos_email ?? claimEmail).toLowerCase().trim();
    const ts = Math.floor(Date.now() / 1000).toString();
    const nonce = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);

    // Signed payload now includes tier + caps so AOS can enforce them.
    // Backwards-compatible: AOS may verify the legacy `email|ts|nonce` shape
    // until it ships the new verifier — until then the token still works.
    const signingString = `${email}|${ts}|${nonce}|${tier ?? ""}|${workspaceLimit}|${seatLimit}`;
    const sig = createHmac("sha256", secret.trim()).update(signingString).digest("hex");

    const token = [
      encodeURIComponent(email),
      ts,
      nonce,
      encodeURIComponent(tier ?? ""),
      String(workspaceLimit),
      String(seatLimit),
      sig,
    ].join(".");

    const url = `${baseUrl.replace(/\/$/, "")}/api/public/circle/sso?token=${token}`;

    await supabase.from("aos_links").upsert(
      {
        user_id: userId,
        aos_email: email,
        verified_at: link?.verified_at ?? new Date().toISOString(),
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    return {
      ok: true,
      url,
      aos_email: email,
      previously_linked: Boolean(link?.verified_at),
      tier,
      workspace_limit: workspaceLimit,
      seat_limit: seatLimit,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// Link an existing AOS account that lives under a different email.
// Verifies the email actually exists on AOS via the snapshot endpoint, then
// upserts aos_links.aos_email. Future SSO mints use this email instead.
// ─────────────────────────────────────────────────────────────────────────────

export type AosLinkResult =
  | { ok: true; aos_email: string; company_name: string | null }
  | { ok: false; error: string };

export const linkExistingAosAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { aosEmail: string }) => {
    const email = String(input?.aosEmail ?? "")
      .toLowerCase()
      .trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("Enter a valid email address.");
    }
    if (email.length > 255) throw new Error("Email is too long.");
    return { aosEmail: email };
  })
  .handler(async ({ data, context }): Promise<AosLinkResult> => {
    const baseUrl = process.env.AOS_BASE_URL;
    const secret = process.env.AOS_SHARED_SECRET;
    if (!baseUrl || !secret) {
      return { ok: false, error: "AOS link not configured on Circle." };
    }

    const ts = Math.floor(Date.now() / 1000);
    const signingSecret = secret.trim();
    const nonce = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
    const { supabase, userId } = context;
    const { data: limitsRows } = await supabase.rpc("get_user_aos_limits", {
      _user_id: userId,
    });
    const limitsRow = Array.isArray(limitsRows) ? limitsRows[0] : limitsRows;
    const tier = (limitsRow?.tier as string | null) ?? "";
    const workspaceLimit = (limitsRow?.workspace_limit as number | null) ?? 0;
    const seatLimit = (limitsRow?.seat_limit as number | null) ?? 0;
    const sig = createHmac("sha256", signingSecret)
      .update(`${data.aosEmail}|${ts}|${nonce}|${tier}|${workspaceLimit}|${seatLimit}`)
      .digest("hex");

    let res: Response;
    try {
      res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/public/circle/snapshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-circle-signature": sig,
          "x-circle-ts": String(ts),
          "x-circle-nonce": nonce,
        },
        redirect: "manual",
        body: JSON.stringify({
          email: data.aosEmail,
          ts,
          nonce,
          sig,
          tier,
          workspace_limit: workspaceLimit,
          seat_limit: seatLimit,
        }),
      });
    } catch (err) {
      console.error("[aos.link] snapshot fetch failed", err);
      return { ok: false, error: "Could not reach AOS to verify that email." };
    }

    if (!res.ok) {
      return { ok: false, error: `AOS returned ${res.status}. Try again in a moment.` };
    }

    const snapshot = normalizeAosSnapshot(await res.json(), data.aosEmail);

    if (!snapshot.linked) {
      // "Pick a workspace" reason means the account exists with multiple workspaces.
      const reason = (snapshot as { reason: string }).reason ?? "";
      if (!/Pick a workspace/i.test(reason)) {
        return {
          ok: false,
          error: `That email isn't on AOS yet. Use the main "Enter AOS" button and we'll set you up automatically.`,
        };
      }
    }

    const { error: upsertError } = await supabase.from("aos_links").upsert(
      {
        user_id: userId,
        aos_email: data.aosEmail,
        verified_at: new Date().toISOString(),
        last_sync_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    if (upsertError) {
      console.error("[aos.link] upsert failed", upsertError);
      return { ok: false, error: "Could not save the link. Try again." };
    }

    return {
      ok: true,
      aos_email: data.aosEmail,
      company_name: snapshot.linked ? snapshot.company_name : null,
    };
  });

// ─────────────────────────────────────────────────────────────────────────────
// SOP hand-off: mint a short-lived signed token that carries a full SopDocument
// payload to AOS. AOS verifies the HMAC, shows a confirm screen
// (workspace + category + owner pre-filled), and writes the SOP into the
// chosen workspace's Knowledge Hub. See docs/aos-sop-handoff-spec.md for the
// receiving-side contract.
//
// Token shape (URL): /hub/import?payload=<base64url-json>&sig=<hex>&ts=&nonce=
// Signing string:    `${email}|${ts}|${nonce}|${version_hash}`
//   - version_hash = sha256(canonical SopDocument JSON) (also lives in payload)
//   - AOS recomputes version_hash from payload; if it doesn't match, reject.
// TTL: 5 minutes (AOS-enforced).
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from "crypto";

type SopHandoffPayload = {
  v: 1;
  aos_email: string;
  ts: number;
  nonce: string;
  source: "circle";
  source_key: string;       // stable per-SOP id (slug of title) — enables "new version" detection
  version_hash: string;     // sha256 of canonical SOP JSON
  sop: unknown;             // full SopDocument
  defaults: {
    category?: string | null;   // pre-fill in AOS Knowledge Hub
    owner?: string | null;
  };
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "sop";
}

function canonicalJson(value: unknown): string {
  // Stable stringify (sorted keys) so version_hash is deterministic across runs.
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function base64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export type AosSopHandoff =
  | { ok: true; url: string; aos_email: string; source_key: string; version_hash: string }
  | { ok: false; error: string };

export const mintAosSopImportToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { sop: Record<string, unknown>; defaults?: { category?: string; owner?: string } }) => {
    if (!input?.sop || typeof input.sop !== "object") {
      throw new Error("Missing SOP payload.");
    }
    const title = (input.sop as { title?: unknown }).title;
    if (typeof title !== "string" || !title.trim()) {
      throw new Error("SOP must have a title.");
    }
    if (title.length > 200) throw new Error("SOP title is too long.");
    return {
      sop: input.sop,
      defaults: {
        category: input.defaults?.category?.toString().slice(0, 80) ?? null,
        owner: input.defaults?.owner?.toString().slice(0, 120) ?? null,
      },
    };
  })
  .handler(async ({ data, context }): Promise<AosSopHandoff> => {
    const baseUrl = process.env.AOS_BASE_URL;
    const secret = process.env.AOS_SHARED_SECRET;
    if (!baseUrl || !secret) {
      return { ok: false, error: "AOS link not configured on Circle." };
    }

    const claimEmail = (context.claims as { email?: string } | null)?.email ?? null;
    if (!claimEmail) return { ok: false, error: "No email on your account." };

    const { supabase, userId } = context;
    const { data: link } = await supabase
      .from("aos_links")
      .select("aos_email")
      .eq("user_id", userId)
      .maybeSingle();

    const aosEmail = (link?.aos_email ?? claimEmail).toLowerCase().trim();
    const ts = Math.floor(Date.now() / 1000);
    const nonce =
      Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);

    const sopTitle = (data.sop as { title: string }).title;
    const sourceKey = `circle-sop-${slugify(sopTitle)}`;
    const versionHash = createHash("sha256").update(canonicalJson(data.sop)).digest("hex");

    const payload: SopHandoffPayload = {
      v: 1,
      aos_email: aosEmail,
      ts,
      nonce,
      source: "circle",
      source_key: sourceKey,
      version_hash: versionHash,
      sop: data.sop,
      defaults: data.defaults,
    };

    const payloadB64 = base64url(JSON.stringify(payload));
    const signingString = `${aosEmail}|${ts}|${nonce}|${versionHash}`;
    const sig = createHmac("sha256", secret.trim()).update(signingString).digest("hex");

    const url =
      `${baseUrl.replace(/\/$/, "")}/hub/import` +
      `?payload=${payloadB64}` +
      `&sig=${sig}` +
      `&ts=${ts}` +
      `&nonce=${encodeURIComponent(nonce)}` +
      `&from=circle`;

    return { ok: true, url, aos_email: aosEmail, source_key: sourceKey, version_hash: versionHash };
  });
