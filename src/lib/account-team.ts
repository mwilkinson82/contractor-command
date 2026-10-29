// v0.8.22 (staged): Team + plan on /account, and the Terms line on the connect page. Pure helpers plus thin wrappers
// over the same database functions the team_* tools use (mcp_team_*, mcp_seat_usage, mcp_is_company_owner). The
// database enforces owner-only, seat caps and plan role gating; this file only shapes inputs and messages.
// The page never sends invite emails and never opens a payment page.
import {
  ROLE_LABEL,
  SEAT_LIMIT_MESSAGE,
  SEAT_PRICE_LABEL,
  TEAM_ROLES,
  normalizeRole,
  seatLimitFromError,
  type Seats,
  type TeamList,
  type TeamRole,
} from "@/lib/mcp/team";

export { ROLE_LABEL, SEAT_PRICE_LABEL, TEAM_ROLES, type Seats, type TeamList, type TeamRole };

export const OWNER_ONLY_MESSAGE =
  "Only a company owner can manage the team. Ask your owner to make this change.";
export const APP_SIGN_IN_HOST = "app.meetathena.io";

// ---- Terms (connect page) ----------------------------------------------------------------------------------------
export const TERMS_URL = "https://meetathena.io/terms";
export const TERMS_VERSION = "2026-10-22";
export const TERMS_TEXT_BEFORE = "I agree to the ";
export const TERMS_LINK_TEXT = "Terms";
export const TERMS_TEXT_AFTER = " and won't copy, extract or reverse engineer Athena.";
export const TERMS_SENTENCE = `${TERMS_TEXT_BEFORE}${TERMS_LINK_TEXT}${TERMS_TEXT_AFTER}`;
export const TERMS_REQUIRED_MESSAGE = "Check the box to agree to the Terms before connecting.";
export const TERMS_SAVE_FAILED_MESSAGE =
  "We couldn't record your agreement, so nothing was connected. Try again.";

/** Approve is allowed only for an entitled member who ticked the Terms box. */
export function canApproveConnect(entitled: boolean, termsChecked: boolean): boolean {
  return entitled === true && termsChecked === true;
}

// ---- Plan line ---------------------------------------------------------------------------------------------------
const PLAN_LABEL: Record<string, string> = {
  circle: "Contractor Circle",
  hardcore: "Contractor Circle Hardcore",
  athena_pm: "Athena PM",
  athena_office: "Athena Office",
};
const PLAN_RATE: Record<string, string> = {
  athena_pm: "$197 / month",
  athena_office: "$397 / month",
};

export function planLabel(tier: string | null | undefined): string {
  if (!tier) return "No Athena plan yet";
  return PLAN_LABEL[tier] ?? tier.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
/** Only Athena plans have a fixed list price; Circle rates vary (and comps pay nothing), so none is shown. */
export function planRate(tier: string | null | undefined): string | null {
  return tier ? (PLAN_RATE[tier] ?? null) : null;
}
export function seatSummary(s: Seats | null | undefined): string {
  if (!s) return "—";
  const used = s.members + s.pending;
  const pend = s.pending ? ` (${s.pending} pending)` : "";
  return s.limit == null ? `${used} in use${pend}` : `${used} of ${s.limit} in use${pend}`;
}
export function seatsLeft(s: Seats | null | undefined): number | null {
  if (!s || s.limit == null) return null;
  return Math.max(0, s.limit - s.members - s.pending);
}

// ---- Add seats ---------------------------------------------------------------------------------------------------
export const SEATS_COMING_SOON = `Adding seats here is coming soon. Extra seats are ${SEAT_PRICE_LABEL}. Ask Athena in chat and we'll set it up with you.`;
export const SEATS_VIA_CHAT = `To add seats, ask Athena in chat ("add 2 seats"). Extra seats are ${SEAT_PRICE_LABEL}.`;
export function addSeatsMessage(checkoutEnabled: boolean): string {
  return checkoutEnabled ? SEATS_VIA_CHAT : SEATS_COMING_SOON;
}

// ---- Errors and inputs -------------------------------------------------------------------------------------------
export function friendlyTeamError(message: string | undefined): string {
  const m = message ?? "";
  const seat = seatLimitFromError(m);
  if (seat)
    return SEAT_LIMIT_MESSAGE(seat.used, seat.limit).replace(
      "no invite was sent",
      "this person wasn't added",
    );
  if (m.includes("Only a company owner")) return OWNER_ONLY_MESSAGE;
  if (m.startsWith("MCP_BAD:")) return m.slice(8);
  if (m.includes("MCP_NO_COMPANY")) return "You aren't a member of that company.";
  if (m.includes("MCP_INACTIVE"))
    return "Your membership isn't active, so team changes are paused. Your job data is saved.";
  return "That didn't save. Try again in a moment.";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export type InviteInput = { email: string; name: string; role: string; jobs: string[] };
export function validateInvite(
  i: InviteInput,
  allowed: TeamRole[] | null,
): { ok: true; role: TeamRole } | { ok: false; error: string } {
  if (!EMAIL_RE.test(i.email.trim())) return { ok: false, error: "Enter a valid email." };
  if (!i.name.trim()) return { ok: false, error: "Enter their name." };
  const r = normalizeRole(i.role);
  if (!r) return { ok: false, error: "Pick a role." };
  if (allowed && !allowed.includes(r))
    return { ok: false, error: `${ROLE_LABEL[r]} isn't included in your plan.` };
  return { ok: true, role: r };
}
/** Owner, All-access and AP see every job, so a job list does nothing for them. */
export function roleUsesJobList(role: TeamRole): boolean {
  return !(role === "owner" || role === "all_access" || role === "ap");
}
export function inviteSavedMessage(name: string, email: string): string {
  return `${name} is invited. Tell them to sign in at ${APP_SIGN_IN_HOST} with ${email}; they join your team the first time they sign in.`;
}

// ---- Database calls (same functions as the team_* tools) ----------------------------------------------------------
type RpcErr = { message: string } | null;
export type AccountDb = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: RpcErr }>;
  from: (t: string) => { select: (c: string) => PromiseLike<{ data: unknown; error: RpcErr }> };
};

export type AccountTeam = {
  companyId: string | null;
  companyName: string | null;
  isOwner: boolean;
  seats: Seats | null;
  team: TeamList | null;
};

export async function loadAccountTeam(
  db: AccountDb,
  preferred?: string | null,
): Promise<AccountTeam> {
  const empty: AccountTeam = {
    companyId: null,
    companyName: null,
    isOwner: false,
    seats: null,
    team: null,
  };
  const [cos, saved] = await Promise.all([
    db.from("mcp_companies").select("id, name"),
    db.from("mcp_user_settings").select("current_company"),
  ]);
  const list = (cos.data as { id: string; name: string | null }[] | null) ?? [];
  if (cos.error || !list.length) return empty;
  // RLS returns only the caller's setting. Validate it against accessible companies;
  // a name or stale preference must never redirect team operations to another tenant.
  const savedId =
    !saved.error && Array.isArray(saved.data)
      ? (saved.data[0] as { current_company?: unknown } | undefined)?.current_company
      : null;
  const co = list.find((c) => c.id === preferred) ?? list.find((c) => c.id === savedId) ?? list[0];
  const [own, seat] = await Promise.all([
    db.rpc("mcp_is_company_owner", { _company: co.id }),
    db.rpc("mcp_seat_usage", { _company: co.id }),
  ]);
  const isOwner = own.data === true;
  let team: TeamList | null = null;
  if (isOwner) {
    const t = await db.rpc("mcp_team_list", { _company: co.id });
    if (!t.error) team = t.data as TeamList;
  }
  return {
    companyId: co.id,
    companyName: co.name,
    isOwner,
    seats: team?.seats ?? (seat.data as Seats | null) ?? null,
    team,
  };
}

type Done = { ok: true } | { ok: false; error: string };
async function call(db: AccountDb, fn: string, args: Record<string, unknown>): Promise<Done> {
  const { error } = await db.rpc(fn, args);
  return error ? { ok: false, error: friendlyTeamError(error.message) } : { ok: true };
}
export const inviteMember = (
  db: AccountDb,
  company: string,
  i: { email: string; name: string; role: TeamRole; jobs: string[] },
) =>
  call(db, "mcp_team_invite", {
    _company: company,
    _email: i.email.trim(),
    _display_name: i.name.trim(),
    _role: i.role,
    _jobs: roleUsesJobList(i.role) ? i.jobs : [],
  });
export const updateMember = (
  db: AccountDb,
  company: string,
  user: string,
  role: TeamRole | null,
  jobs: string[] | null,
) =>
  call(db, "mcp_team_update_member", { _company: company, _user: user, _role: role, _jobs: jobs });
export const removeMember = (
  db: AccountDb,
  company: string,
  who: { user?: string | null; email?: string | null },
) =>
  call(db, "mcp_team_remove_member", {
    _company: company,
    _user: who.user ?? null,
    _email: who.email ?? null,
  });

export async function recordTermsAcceptance(
  db: AccountDb,
  authorizationId: string | null,
  userAgent?: string | null,
): Promise<Done> {
  const { error } = await db.rpc("mcp_accept_terms", {
    _version: TERMS_VERSION,
    _url: TERMS_URL,
    _context: "connect",
    _authorization: authorizationId,
    _user_agent: userAgent ?? null,
  });
  return error ? { ok: false, error: TERMS_SAVE_FAILED_MESSAGE } : { ok: true };
}
