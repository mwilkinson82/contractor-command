// Athena account page: Team & access (Nov 2026 redesign). Same database functions as the chat team tools
// (mcp_team_invite / update_member / remove_member), which enforce owner-only, seat caps and plan roles.
// New here: plain role cards, invite emails with Resend, a copyable sign-in link, a red remove confirm, and
// phone-friendly people cards. The Contractor Circle Hub keeps its own TeamSection.
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Copy, Loader2, Mail, Pencil, UserPlus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSeatPurchaseStatus, sendTeamInviteEmail } from "@/lib/account-team.functions";
import {
  ROLE_LABEL,
  SEAT_PRICE_LABEL,
  TEAM_ROLES,
  addSeatsMessage,
  inviteMember,
  removeMember,
  roleUsesJobList,
  seatsLeft,
  updateMember,
  validateInvite,
  type AccountDb,
  type AccountTeam,
  type TeamRole,
} from "@/lib/account-team";
import { ROLE_SEES } from "@/lib/mcp/team";

const db = supabase as unknown as AccountDb;
const SIGN_IN_URL = "https://app.meetathena.io/login";
// Order the cards from the role most owners invite first.
const ROLE_ORDER: TeamRole[] = [
  "pm",
  "super",
  "ap",
  "estimating",
  "contracts",
  "all_access",
  "owner",
];

export function inviteEmailNote(status: string, name: string, email: string): string {
  if (status === "sent") return `${name} is invited. We emailed ${email} a link to sign in.`;
  if (status === "off")
    return `${name} is invited. Invite emails aren't switched on yet, so send them the sign-in link: ${SIGN_IN_URL}`;
  return `${name} is invited, but the email didn't go out. Use Copy sign-in link and send it to ${email} yourself.`;
}

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

function sees(role: TeamRole) {
  const s = ROLE_SEES[role];
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function RoleCards({
  name,
  value,
  allowed,
  onChange,
}: {
  name: string;
  value: TeamRole;
  allowed: TeamRole[];
  onChange: (r: TeamRole) => void;
}) {
  return (
    <fieldset className="aa-roles">
      <legend className="aa-flabel">Role</legend>
      {ROLE_ORDER.map((r) => {
        const locked = !allowed.includes(r);
        return (
          <label key={r} className={locked ? "aa-role aa-locked" : "aa-role"}>
            <input
              type="radio"
              name={name}
              value={r}
              checked={value === r}
              disabled={locked}
              onChange={() => onChange(r)}
            />
            <strong>{ROLE_LABEL[r]}</strong>
            <small>{locked ? "Not in your plan" : sees(r)}</small>
          </label>
        );
      })}
    </fieldset>
  );
}

function JobChecks({
  jobs,
  value,
  onChange,
}: {
  jobs: { job_number: string; name: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (!jobs.length) return <p className="aa-hint">No jobs yet. You can add them to jobs later.</p>;
  return (
    <fieldset className="aa-jobpick">
      <legend className="aa-flabel">Jobs they work on</legend>
      {jobs.map((j) => (
        <label key={j.job_number}>
          <input
            type="checkbox"
            checked={value.includes(j.job_number)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, j.job_number]
                  : value.filter((x) => x !== j.job_number),
              )
            }
          />
          {j.job_number} · {j.name}
        </label>
      ))}
    </fieldset>
  );
}

type Confirm = { user?: string; email?: string; name: string };

export function AthenaTeamSection({
  state,
  loading,
  reload,
  inviteEmailEnabled = false,
}: {
  state: AccountTeam | null;
  loading: boolean;
  reload: () => Promise<void>;
  inviteEmailEnabled?: boolean;
}) {
  const seatStatusFn = useServerFn(getSeatPurchaseStatus);
  const inviteEmailFn = useServerFn(sendTeamInviteEmail);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seatMsg, setSeatMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [inv, setInv] = useState({
    email: "",
    name: "",
    role: "pm" as TeamRole,
    jobs: [] as string[],
  });
  const [edit, setEdit] = useState<{ role: TeamRole; jobs: string[] }>({ role: "pm", jobs: [] });

  if (loading && !state)
    return (
      <div className="aa-card" role="status">
        <Loader2 size={16} className="aa-spin" /> Loading your team…
      </div>
    );
  if (!state?.companyId)
    return (
      <div className="aa-card">
        <h2>No Athena company yet</h2>
        <p className="aa-lede">
          Ask Athena in your chat to set up your company. Your team shows here after.
        </p>
      </div>
    );
  if (!state.isOwner || !state.team)
    return (
      <div className="aa-card">
        <h2>Your team</h2>
        <p className="aa-lede">
          Your company Owner invites people and sets what they can see. Ask them if you need access
          to another job.
        </p>
      </div>
    );

  const team = state.team;
  const co = state.companyId;
  const allowed = (team.roles_allowed ?? [...TEAM_ROLES]) as TeamRole[];
  const left = seatsLeft(team.seats);
  const used = team.seats.members + team.seats.pending;
  const limit = team.seats.limit;

  async function act(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) {
    setBusy(true);
    setErr(null);
    setNote(null);
    const r = await fn();
    if (!r.ok) {
      setBusy(false);
      setErr(r.error);
      return false;
    }
    setNote(ok);
    await reload();
    setBusy(false);
    return true;
  }

  async function emailInvite(email: string): Promise<string> {
    if (!inviteEmailEnabled) return "off";
    try {
      const r = await inviteEmailFn({ data: { companyId: co, email } });
      return r.status;
    } catch {
      return "failed";
    }
  }

  async function onInvite() {
    const v = validateInvite(inv, allowed);
    if (!v.ok) return setErr(v.error);
    const name = inv.name.trim();
    const email = inv.email.trim();
    setBusy(true);
    setErr(null);
    setNote(null);
    const saved = await inviteMember(db, co, { ...inv, role: v.role });
    if (!saved.ok) {
      setBusy(false);
      return setErr(saved.error);
    }
    const status = await emailInvite(email);
    setNote(inviteEmailNote(status, name, email));
    setInv({ email: "", name: "", role: "pm", jobs: [] });
    setInviting(false);
    await reload();
    setBusy(false);
  }

  async function onResend(email: string, name: string) {
    setBusy(true);
    setErr(null);
    setNote(null);
    const status = await emailInvite(email);
    setBusy(false);
    if (status === "sent") setNote(`Sent ${name} a fresh invite at ${email}.`);
    else setErr(`The email to ${email} didn't go out. Use Copy sign-in link and send it yourself.`);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(SIGN_IN_URL);
      setNote(`Copied ${SIGN_IN_URL}. They sign in there with the email you invited.`);
    } catch {
      setNote(`Send them this link: ${SIGN_IN_URL}. They sign in with the email you invited.`);
    }
  }

  async function onAddSeats() {
    setSeatMsg(null);
    let enabled = false;
    try {
      enabled = (await seatStatusFn()).checkoutEnabled === true;
    } catch {
      enabled = false;
    }
    setSeatMsg(addSeatsMessage(enabled)); // Never opens a payment page from here.
  }

  const accessText = (role: TeamRole, jobs: string[]) =>
    !roleUsesJobList(role) ? "All jobs" : jobs.length ? jobs.join(", ") : "No jobs yet";

  return (
    <>
      <section className="aa-card aa-seats" aria-label="Seats">
        <div>
          <h2 className="aa-num">
            {limit == null ? `${used} seats in use` : `${used} of ${limit} seats in use`}
          </h2>
          <p className="aa-lede">
            {team.seats.pending ? `${team.seats.pending} waiting to sign in. ` : ""}
            {left != null ? `${left} open. ` : ""}Extra seats are {SEAT_PRICE_LABEL}.
          </p>
        </div>
        {limit != null ? (
          <div className="aa-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }} />
          </div>
        ) : null}
        <button
          type="button"
          className="aa-btn aa-btn-ghost"
          onClick={() => void onAddSeats()}
          disabled={busy}
        >
          Add seats
        </button>
        {seatMsg ? (
          <p className="aa-note" style={{ flexBasis: "100%" }}>
            {seatMsg}
          </p>
        ) : null}
      </section>

      {note ? (
        <p className="aa-note" role="status">
          {note}
        </p>
      ) : null}
      {err ? (
        <p className="aa-error" role="alert">
          {err}
        </p>
      ) : null}

      {inviting ? (
        <section className="aa-invite" aria-labelledby="aa-invite-title">
          <div className="aa-row">
            <h2 id="aa-invite-title">
              <UserPlus size={17} aria-hidden="true" /> Invite a person
            </h2>
            <button
              type="button"
              className="aa-btn aa-btn-ghost aa-btn-sm"
              onClick={() => setInviting(false)}
              disabled={busy}
            >
              <X size={14} /> Close
            </button>
          </div>
          <div className="aa-form-grid">
            <div className="aa-field">
              <label htmlFor="aa-inv-name">Name</label>
              <input
                id="aa-inv-name"
                value={inv.name}
                autoComplete="off"
                onChange={(e) => setInv({ ...inv, name: e.target.value })}
              />
            </div>
            <div className="aa-field">
              <label htmlFor="aa-inv-email">Work email</label>
              <input
                id="aa-inv-email"
                type="email"
                value={inv.email}
                autoComplete="off"
                onChange={(e) => setInv({ ...inv, email: e.target.value })}
              />
            </div>
          </div>
          <RoleCards
            name="aa-inv-role"
            value={inv.role}
            allowed={allowed}
            onChange={(role) => setInv({ ...inv, role })}
          />
          {roleUsesJobList(inv.role) ? (
            <JobChecks
              jobs={team.jobs}
              value={inv.jobs}
              onChange={(jobs) => setInv({ ...inv, jobs })}
            />
          ) : (
            <p className="aa-hint">
              {ROLE_LABEL[inv.role]} sees every job, so there's no job list to pick.
            </p>
          )}
          <p className="aa-hint">
            {inviteEmailEnabled
              ? "We'll email them a link to sign in with a code; no password needed. The invite uses a seat right away."
              : `Invite emails aren't on yet, so send them ${SIGN_IN_URL} yourself. The invite uses a seat right away.`}
          </p>
          <div className="aa-save-bar">
            <button
              type="button"
              className="aa-btn aa-btn-primary"
              onClick={() => void onInvite()}
              disabled={busy || left === 0}
            >
              {busy ? <Loader2 size={14} className="aa-spin" /> : <Mail size={14} />}
              {inviteEmailEnabled ? "Send invite" : "Save invite"}
            </button>
            {left === 0 ? (
              <span className="aa-hint">You're out of seats. Add seats to invite more people.</span>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="aa-card aa-people-card" aria-labelledby="aa-people-title">
        <div className="aa-row" style={{ padding: "10px 12px 14px" }}>
          <h2 id="aa-people-title">People</h2>
          {!inviting ? (
            <button
              type="button"
              className="aa-btn aa-btn-primary"
              onClick={() => {
                setInviting(true);
                setErr(null);
                setNote(null);
              }}
              disabled={busy || left === 0}
            >
              <UserPlus size={15} /> Invite a person
            </button>
          ) : null}
        </div>
        {confirm ? (
          <div
            className="aa-confirm"
            role="alertdialog"
            aria-label="Confirm removal"
            style={{ margin: "0 12px 12px" }}
          >
            <p>
              {confirm.user
                ? `Remove ${confirm.name}? They lose access right away. Their job history stays.`
                : `Cancel the invite for ${confirm.name}? Their seat frees up.`}
            </p>
            <button
              type="button"
              className="aa-btn aa-btn-danger aa-btn-sm"
              disabled={busy}
              onClick={async () => {
                const c = confirm;
                setConfirm(null);
                await act(
                  () => removeMember(db, co, { user: c.user, email: c.email }),
                  c.user
                    ? `${c.name} was removed. Their job history stays.`
                    : `The invite for ${c.name} was cancelled.`,
                );
              }}
            >
              {confirm.user ? "Remove" : "Cancel invite"}
            </button>
            <button
              type="button"
              className="aa-btn aa-btn-ghost aa-btn-sm"
              onClick={() => setConfirm(null)}
            >
              Keep
            </button>
          </div>
        ) : null}
        <table className="aa-people">
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">Role</th>
              <th scope="col">Jobs</th>
              <th scope="col">
                <span className="aa-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {team.members.map((m) => {
              const isEditing = editing === m.user_id;
              return [
                <tr key={m.user_id}>
                  <td>
                    <div className="aa-person">
                      <span className="aa-avatar" aria-hidden="true">
                        {initials(m.display_name)}
                      </span>
                      <div>
                        <strong>{m.display_name}</strong>
                        {m.email ? <small>{m.email}</small> : null}
                      </div>
                    </div>
                  </td>
                  <td data-label="Role">
                    <span
                      className={
                        m.role === "owner" ? "aa-pill aa-pill-blue" : "aa-pill aa-pill-mute"
                      }
                    >
                      {ROLE_LABEL[m.role] ?? m.role}
                    </span>
                    {m.locked ? (
                      <small className="aa-hint" style={{ display: "block" }}>
                        Paused: not in your plan
                      </small>
                    ) : null}
                  </td>
                  <td data-label="Jobs" className="aa-jobs">
                    {accessText(m.role, m.jobs)}
                  </td>
                  <td className="aa-acts">
                    {m.role !== "owner" && !isEditing ? (
                      <>
                        <button
                          type="button"
                          className="aa-btn aa-btn-ghost aa-btn-sm"
                          disabled={busy}
                          onClick={() => {
                            setEditing(m.user_id);
                            setEdit({ role: m.role, jobs: m.jobs });
                            setErr(null);
                          }}
                        >
                          <Pencil size={13} /> Edit access
                        </button>
                        <button
                          type="button"
                          className="aa-btn aa-btn-ghost aa-btn-sm"
                          disabled={busy}
                          onClick={() => setConfirm({ user: m.user_id, name: m.display_name })}
                        >
                          Remove
                        </button>
                      </>
                    ) : null}
                  </td>
                </tr>,
                isEditing ? (
                  <tr key={`${m.user_id}-edit`} className="aa-edit-row">
                    <td colSpan={4}>
                      <div className="aa-access-editor">
                        <RoleCards
                          name={`aa-edit-${m.user_id}`}
                          value={edit.role}
                          allowed={allowed}
                          onChange={(role) => setEdit({ ...edit, role })}
                        />
                        {roleUsesJobList(edit.role) ? (
                          <JobChecks
                            jobs={team.jobs}
                            value={edit.jobs}
                            onChange={(jobs) => setEdit({ ...edit, jobs })}
                          />
                        ) : null}
                        <div className="aa-acts" style={{ justifyContent: "flex-start" }}>
                          <button
                            type="button"
                            className="aa-btn aa-btn-primary aa-btn-sm"
                            disabled={busy}
                            onClick={async () => {
                              const ok = await act(
                                () =>
                                  updateMember(
                                    db,
                                    co,
                                    m.user_id,
                                    edit.role,
                                    roleUsesJobList(edit.role) ? edit.jobs : null,
                                  ),
                                `${m.display_name} is now ${ROLE_LABEL[edit.role]}.`,
                              );
                              if (ok) setEditing(null);
                            }}
                          >
                            Save access
                          </button>
                          <button
                            type="button"
                            className="aa-btn aa-btn-ghost aa-btn-sm"
                            disabled={busy}
                            onClick={() => setEditing(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null,
              ];
            })}
            {team.pending.map((p) => (
              <tr key={p.email} className="aa-pending">
                <td>
                  <div className="aa-person">
                    <span className="aa-avatar" aria-hidden="true">
                      {initials(p.display_name)}
                    </span>
                    <div>
                      <strong>{p.display_name}</strong>
                      <small>{p.email}</small>
                    </div>
                  </div>
                </td>
                <td data-label="Role">
                  <span className="aa-pill aa-pill-mute">{ROLE_LABEL[p.role] ?? p.role}</span>{" "}
                  <span className="aa-pill aa-pill-warn">Waiting to sign in</span>
                </td>
                <td data-label="Jobs" className="aa-jobs">
                  {roleUsesJobList(p.role) ? "Set when invited" : "All jobs"}
                </td>
                <td className="aa-acts">
                  {inviteEmailEnabled ? (
                    <button
                      type="button"
                      className="aa-btn aa-btn-ghost aa-btn-sm"
                      disabled={busy}
                      onClick={() => void onResend(p.email, p.display_name)}
                    >
                      <Mail size={13} /> Resend email
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="aa-btn aa-btn-ghost aa-btn-sm"
                    onClick={() => void copyLink()}
                  >
                    <Copy size={13} /> Copy sign-in link
                  </button>
                  <button
                    type="button"
                    className="aa-btn aa-btn-ghost aa-btn-sm"
                    disabled={busy}
                    onClick={() => setConfirm({ email: p.email, name: p.display_name })}
                  >
                    Cancel invite
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <details className="aa-card">
        <summary>Who sees what</summary>
        <dl className="aa-who-sees">
          {ROLE_ORDER.map((r) => (
            <div key={r}>
              <dt>{ROLE_LABEL[r]}</dt>
              <dd>
                {sees(r)}.{allowed.includes(r) ? "" : " Not in your plan."}
              </dd>
            </div>
          ))}
        </dl>
        <p className="aa-hint" style={{ marginTop: 12 }}>
          PMs, Supers, Estimating and Contracts only see the jobs you pick for them. Owner,
          All-access and AP see every job.
        </p>
      </details>
    </>
  );
}
