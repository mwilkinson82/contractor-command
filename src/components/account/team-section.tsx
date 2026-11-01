// v0.8.22 (staged): Team section on /account. Owners manage seats, invites, roles, job access and removals through
// the same database functions as Athena's team tools. Non-owners see a read-only line. Navy/blue/gray; red only for errors.
import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, UserPlus, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSeatPurchaseStatus } from "@/lib/account-team.functions";
import {
  ROLE_LABEL,
  SEAT_PRICE_LABEL,
  TEAM_ROLES,
  addSeatsMessage,
  inviteMember,
  inviteSavedMessage,
  loadAccountTeam,
  removeMember,
  roleUsesJobList,
  seatSummary,
  seatsLeft,
  updateMember,
  validateInvite,
  type AccountDb,
  type AccountTeam,
  type TeamRole,
} from "@/lib/account-team";

const db = supabase as unknown as AccountDb;
const NAVY = "#1E3A8A";
const btn =
  "inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium disabled:opacity-50";
const primary = `${btn} bg-[#1E3A8A] text-white hover:bg-[#2563EB]`;
const secondary = `${btn} border border-[#D1D5DB] bg-white text-[#111827] hover:bg-[#F3F4F6]`;
const input =
  "w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px] focus:border-[#2563EB] focus:outline-none";

export function useAccountTeam() {
  const [state, setState] = useState<AccountTeam | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setState(await loadAccountTeam(db));
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { state, loading, reload };
}

export function TeamSection({ state, loading, reload }: ReturnType<typeof useAccountTeam>) {
  const seatStatusFn = useServerFn(getSeatPurchaseStatus);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seatMsg, setSeatMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{
    user?: string;
    email?: string;
    name: string;
  } | null>(null);
  const [inv, setInv] = useState({ email: "", name: "", role: "pm", jobs: [] as string[] });
  const [edit, setEdit] = useState<{ role: TeamRole; jobs: string[] }>({ role: "pm", jobs: [] });

  if (loading) {
    return (
      <Shell>
        <p className="mt-4 flex items-center gap-2 text-[13px] text-[#6B7280]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your team…
        </p>
      </Shell>
    );
  }
  if (!state?.companyId) {
    return (
      <Shell>
        <p className="mt-4 text-[13px] text-[#6B7280]">
          No Athena company yet. Set one up by chatting with Athena, and your team shows here.
        </p>
      </Shell>
    );
  }
  if (!state.isOwner || !state.team) {
    return (
      <Shell>
        <p className="mt-4 text-[13px] text-[#374151]">Seats: {seatSummary(state.seats)}</p>
        <p className="mt-1 text-[13px] text-[#6B7280]">Your company owner manages the team.</p>
      </Shell>
    );
  }
  const team = state.team;
  const co = state.companyId;
  const roles = (team.roles_allowed ?? [...TEAM_ROLES]) as TeamRole[];
  const left = seatsLeft(team.seats);

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>, ok: string) {
    setBusy(true);
    setErr(null);
    setNote(null);
    const r = await fn();
    setBusy(false);
    if (!r.ok) {
      setErr(r.error);
      return false;
    }
    setNote(ok);
    await reload();
    return true;
  }
  async function onInvite() {
    const v = validateInvite(inv, roles);
    if (!v.ok) {
      setErr(v.error);
      return;
    }
    const done = await run(
      () => inviteMember(db, co, { ...inv, role: v.role }),
      inviteSavedMessage(inv.name.trim(), inv.email.trim()),
    );
    if (done) setInv({ email: "", name: "", role: "pm", jobs: [] });
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

  return (
    <Shell>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
        <p className="text-[13px] text-[#111827]">
          <span className="font-semibold" style={{ color: NAVY }}>
            Seats:
          </span>{" "}
          {seatSummary(team.seats)}
          {left != null ? ` · ${left} open` : ""}
        </p>
        <button type="button" className={secondary} onClick={onAddSeats} disabled={busy}>
          Add seats · {SEAT_PRICE_LABEL}
        </button>
      </div>
      {seatMsg && <p className="mt-2 text-[12px] text-[#374151]">{seatMsg}</p>}

      <ul className="mt-5 divide-y divide-[#E5E7EB] rounded-xl border border-[#E5E7EB]">
        {team.members.map((m) => {
          const isEditing = editing === m.user_id;
          const allJobs = !roleUsesJobList(m.role);
          return (
            <li key={m.user_id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[14px] font-medium text-[#111827]">
                    {m.display_name}
                    {m.email ? (
                      <span className="ml-2 text-[12px] font-normal text-[#6B7280]">{m.email}</span>
                    ) : null}
                  </p>
                  <p className="text-[12px] text-[#6B7280]">
                    {ROLE_LABEL[m.role] ?? m.role} ·{" "}
                    {allJobs
                      ? "all jobs"
                      : m.jobs.length
                        ? `jobs ${m.jobs.join(", ")}`
                        : "no jobs yet"}
                    {m.locked ? " · locked: your plan doesn't include this role" : ""}
                  </p>
                </div>
                {m.role !== "owner" && !isEditing && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={secondary}
                      disabled={busy}
                      onClick={() => {
                        setEditing(m.user_id);
                        setEdit({ role: m.role, jobs: m.jobs });
                        setErr(null);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={secondary}
                      disabled={busy}
                      onClick={() => setConfirmRemove({ user: m.user_id, name: m.display_name })}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              {isEditing && (
                <div className="mt-3 space-y-3 rounded-lg bg-[#F9FAFB] p-3">
                  <RolePicker
                    roles={roles}
                    value={edit.role}
                    onChange={(role) => setEdit({ ...edit, role })}
                  />
                  {roleUsesJobList(edit.role) && (
                    <JobPicker
                      jobs={team.jobs}
                      value={edit.jobs}
                      onChange={(jobs) => setEdit({ ...edit, jobs })}
                    />
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={primary}
                      disabled={busy}
                      onClick={async () => {
                        const ok = await run(
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
                      Save change
                    </button>
                    <button
                      type="button"
                      className={secondary}
                      disabled={busy}
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
        {team.pending.map((p) => (
          <li key={p.email} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <p className="text-[14px] text-[#111827]">
                {p.display_name} <span className="text-[12px] text-[#6B7280]">{p.email}</span>
              </p>
              <p className="text-[12px] text-[#6B7280]">
                {ROLE_LABEL[p.role] ?? p.role} · invited, waiting to sign in at app.meetathena.io
              </p>
            </div>
            <button
              type="button"
              className={secondary}
              disabled={busy}
              onClick={() => setConfirmRemove({ email: p.email, name: p.display_name })}
            >
              Cancel invite
            </button>
          </li>
        ))}
      </ul>

      {confirmRemove && (
        <div className="mt-3 rounded-lg border border-[#D1D5DB] bg-white p-3 text-[13px]">
          <p className="text-[#111827]">
            {confirmRemove.user
              ? `Remove ${confirmRemove.name} from your team? They lose access right away; their job history stays.`
              : `Cancel the invite for ${confirmRemove.name}?`}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={primary}
              disabled={busy}
              onClick={async () => {
                const c = confirmRemove;
                setConfirmRemove(null);
                await run(
                  () => removeMember(db, co, { user: c.user, email: c.email }),
                  c.user
                    ? `${c.name} was removed. Their job history stays.`
                    : `The invite for ${c.name} was cancelled.`,
                );
              }}
            >
              Yes
            </button>
            <button type="button" className={secondary} onClick={() => setConfirmRemove(null)}>
              No
            </button>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-xl border border-[#E5E7EB] p-4">
        <p className="flex items-center gap-2 text-[14px] font-semibold" style={{ color: NAVY }}>
          <UserPlus className="h-4 w-4" /> Invite a person
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <input
            className={input}
            placeholder="Name"
            value={inv.name}
            onChange={(e) => setInv({ ...inv, name: e.target.value })}
          />
          <input
            className={input}
            placeholder="Email"
            type="email"
            value={inv.email}
            onChange={(e) => setInv({ ...inv, email: e.target.value })}
          />
        </div>
        <div className="mt-3">
          <RolePicker
            roles={roles}
            value={inv.role as TeamRole}
            onChange={(role) => setInv({ ...inv, role })}
          />
        </div>
        {roleUsesJobList(inv.role as TeamRole) && (
          <div className="mt-3">
            <JobPicker
              jobs={team.jobs}
              value={inv.jobs}
              onChange={(jobs) => setInv({ ...inv, jobs })}
            />
          </div>
        )}
        <p className="mt-3 text-[12px] text-[#6B7280]">
          No email goes out. Tell them to sign in at app.meetathena.io with this email. The invite
          uses a seat right away.
        </p>
        <button
          type="button"
          className={`${primary} mt-3`}
          disabled={busy || left === 0}
          onClick={onInvite}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Save invite
        </button>
        {left === 0 && (
          <p className="mt-2 text-[12px] text-[#374151]">
            You're at your seat limit. Add seats to invite more people.
          </p>
        )}
      </div>

      {note && <p className="mt-3 text-[13px] text-[#1E3A8A]">{note}</p>}
      {err && (
        <p role="alert" className="mt-3 text-[13px] text-destructive">
          {err}
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 min-w-0 [overflow-wrap:anywhere] [&_*]:min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-7">
      <p className="label-mono">Team</p>
      <h3 className="mt-2 flex items-center gap-2 font-display text-xl" style={{ color: NAVY }}>
        <Users className="h-5 w-5" /> People, roles & job access.
      </h3>
      {children}
    </div>
  );
}

function RolePicker({
  roles,
  value,
  onChange,
}: {
  roles: TeamRole[];
  value: TeamRole;
  onChange: (r: TeamRole) => void;
}) {
  return (
    <label className="block text-[12px] text-[#374151]">
      Role
      <select
        className={`${input} mt-1`}
        value={value}
        onChange={(e) => onChange(e.target.value as TeamRole)}
      >
        {roles.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

function JobPicker({
  jobs,
  value,
  onChange,
}: {
  jobs: { job_number: string; name: string }[];
  value: string[];
  onChange: (j: string[]) => void;
}) {
  if (!jobs.length) return <p className="text-[12px] text-[#6B7280]">No jobs yet.</p>;
  return (
    <fieldset className="text-[12px] text-[#374151]">
      <legend>Jobs they can open</legend>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">
        {jobs.map((j) => (
          <label key={j.job_number} className="flex items-center gap-2">
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
            {j.job_number} {j.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
