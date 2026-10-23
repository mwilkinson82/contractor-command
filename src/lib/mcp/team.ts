// 0.8.16: team management (owner invites, roles, job access, seats). Pure helpers; the database functions enforce
// owner-only, seat caps and plan role gating (migration 20261021180000_athena_team_invites.sql).
export const TEAM_ROLES = ["owner", "pm", "all_access", "ap", "estimating", "contracts", "super"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const ROLE_LABEL: Record<TeamRole, string> = {
  owner: "Owner", pm: "PM", all_access: "All-access", ap: "AP (Accounts Payable)", estimating: "Estimating", contracts: "Contracts", super: "Super",
};
export const ROLE_SEES: Record<TeamRole, string> = {
  owner: "everything, including restricted jobs",
  all_access: "everything, including restricted jobs",
  pm: "everything on their jobs",
  ap: "everything financial",
  estimating: "the contract side of jobs",
  contracts: "the contract side of jobs",
  super: "their jobs' schedule, lookahead, dailies and photos, no dollars",
};

/** 'finance' (the old name) and a few spoken forms are accepted on input; output always says AP. */
export function normalizeRole(input: string): TeamRole | null {
  const r = input.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const alias: Record<string, TeamRole> = { finance: "ap", accounts_payable: "ap", superintendent: "super", allaccess: "all_access", project_manager: "pm" };
  const v = (alias[r] ?? r) as TeamRole;
  return (TEAM_ROLES as readonly string[]).includes(v) ? v : null;
}

export type Seats = { tier: string | null; limit: number | null; members: number; pending: number; extra_seats?: number };
export type TeamMember = { user_id: string; display_name: string; role: TeamRole; email?: string | null; locked: boolean; jobs: string[] };
export type TeamList = {
  members: TeamMember[];
  pending: { email: string; display_name: string; role: TeamRole; invited_at: string }[];
  jobs: { job_number: string; name: string; restricted: boolean }[];
  seats: Seats;
  roles_allowed: TeamRole[] | null;
};

export const SEAT_PRICE_LABEL = "$49 per seat per month";

export function seatLine(s: Seats): string {
  const used = s.members + s.pending;
  if (s.limit == null) return `Seats: ${used} in use (${s.pending} pending invite${s.pending === 1 ? "" : "s"}).`;
  return `Seats: ${used} of ${s.limit} in use, counting ${s.pending} pending invite${s.pending === 1 ? "" : "s"}.`;
}

export const SEAT_LIMIT_MESSAGE = (used: number, limit: number) =>
  `You're at your seat limit (${used} of ${limit}, counting pending invites), so no invite was sent. Want to add seats? Extra seats are ${SEAT_PRICE_LABEL}.`;

/** Parse the database's MCP_SEAT_LIMIT:<used>:<limit> error. */
export function seatLimitFromError(message: string | undefined): { used: number; limit: number } | null {
  const m = /MCP_SEAT_LIMIT:(\d+):(\d+)/.exec(message ?? "");
  return m ? { used: Number(m[1]), limit: Number(m[2]) } : null;
}

/** Numbered list for hosts without widgets (Claude, Codex, Grok Bot). Numbers let the owner answer "2: AP, jobs 2701". */
export function renderTeamList(t: TeamList): string {
  const lines: string[] = ["Your team:"];
  t.members.forEach((m, i) => {
    const jobs = m.role === "owner" || m.role === "all_access" || m.role === "ap" ? "all jobs" : m.jobs.length ? `jobs ${m.jobs.join(", ")}` : "no jobs yet";
    lines.push(`${i + 1}. ${m.display_name}, ${ROLE_LABEL[m.role] ?? m.role}, ${jobs}${m.locked ? " (locked: your plan doesn't include this role; upgrading unlocks it)" : ""}`);
  });
  if (t.pending.length) {
    lines.push("", "Waiting to sign in:");
    t.pending.forEach((p, i) => lines.push(`${t.members.length + i + 1}. ${p.display_name} <${p.email}>, ${ROLE_LABEL[p.role] ?? p.role}, invited`));
  }
  lines.push("", seatLine(t.seats));
  return lines.join("\n");
}

export function rolesMenu(allowed: TeamRole[] | null): string {
  const roles = allowed ?? [...TEAM_ROLES];
  return roles.map((r, i) => `${i + 1}. ${ROLE_LABEL[r]}: sees ${ROLE_SEES[r]}`).join("\n");
}

/** Plain-English confirm line the host shows before any write. */
export function confirmLine(action: "invite" | "update" | "remove", who: string, role?: TeamRole | null, jobs?: string[] | null): string {
  const j = jobs == null ? "" : jobs.length ? ` with access to jobs ${jobs.join(", ")}` : " with no job access";
  if (action === "invite") return `Invite ${who} as ${role ? ROLE_LABEL[role] : "?"}${j}? They'll get an email asking them to sign in at app.meetathena.io. Yes or no?`;
  if (action === "update") return `Change ${who}${role ? ` to ${ROLE_LABEL[role]}` : ""}${j}? Yes or no?`;
  return `Remove ${who} from your team? They lose access right away; their job history stays. Yes or no?`;
}

// ChatGPT (Apps SDK) selection card. Registered as an output template resource; the card's Confirm button calls the
// matching write tool with confirmed: true via window.openai.callTool, so the write still goes through the same checks.
export const TEAM_WIDGET_URI = "ui://athena/team-picker.html";
export const TEAM_WIDGET_MIME = "text/html+skybridge";

export function teamWidgetHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font:14px system-ui,sans-serif;color:#111827;margin:0;padding:12px;background:#fff}
.card{border:1px solid #D1D5DB;border-radius:10px;padding:12px;margin-bottom:10px}
h3{margin:0 0 8px;font-size:14px;color:#1E3A8A}label{display:block;padding:3px 0}
.muted{color:#6B7280}.locked{color:#6B7280;font-style:italic}
button{background:#2563EB;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
button.secondary{background:#F3F4F6;color:#111827}#confirm{display:none}
</style></head><body><div id="app"></div><script>
(function(){
var o=window.openai||{};var d=(o.toolOutput||{}).team||{members:[],pending:[],jobs:[],seats:{},roles_allowed:null};
var labels=${JSON.stringify(ROLE_LABEL)};var allRoles=${JSON.stringify(TEAM_ROLES)};
var roles=d.roles_allowed||allRoles;var app=document.getElementById('app');
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
var h='<div class="card"><h3>People</h3>';
d.members.forEach(function(m){h+='<label><input type="radio" name="p" value="'+esc(m.user_id)+'" data-name="'+esc(m.display_name)+'"> '+esc(m.display_name)+' <span class="muted">'+esc(labels[m.role]||m.role)+'</span>'+(m.locked?' <span class="locked">locked</span>':'')+'</label>'});
h+='</div><div class="card"><h3>Role</h3>';
roles.forEach(function(r){h+='<label><input type="radio" name="r" value="'+r+'"> '+esc(labels[r])+'</label>'});
h+='</div><div class="card"><h3>Jobs</h3>';
function jobOnce(j){var n=String(j.job_number||'').trim();var name=String(j.name||'').replace(/ +/g,' ').trim();if(!n)return name;var low=name.toLowerCase();var key=n.toLowerCase();if(low.indexOf(key)!==0)return name?n+' '+name:n;var rest=name.slice(n.length);function peel(s){s=s.replace(/^ +/,'').trim();var c=s.charAt(0);while(c==='–'||c==='—'||c==='-'||c===' '){s=s.slice(1).replace(/^ +/,'').trim();c=s.charAt(0)}return s}rest=peel(rest);while(rest.toLowerCase().indexOf(key)===0){rest=peel(rest.slice(n.length))}return rest?n+' '+rest:n}
d.jobs.forEach(function(j){h+='<label><input type="checkbox" name="j" value="'+esc(j.job_number)+'"> '+esc(jobOnce(j))+'</label>'});
h+='</div><button id="review">Review change</button><div id="confirm" class="card"><p id="summary"></p><button id="yes">Yes, make this change</button> <button id="no" class="secondary">Cancel</button></div>';
app.innerHTML=h;var pending=null;
function val(n){var e=document.querySelector('input[name='+n+']:checked');return e?e:null}
document.getElementById('review').onclick=function(){var p=val('p');if(!p)return;var r=val('r');
var jobs=[].slice.call(document.querySelectorAll('input[name=j]:checked')).map(function(e){return e.value});
pending={user_id:p.value,role:r?r.value:undefined,job_numbers:jobs,company_id:d.company,confirmed:true};
document.getElementById('summary').textContent='Change '+p.getAttribute('data-name')+(r?' to '+labels[r.value]:'')+' with jobs '+(jobs.join(', ')||'none')+'?';
document.getElementById('confirm').style.display='block'};
document.getElementById('no').onclick=function(){pending=null;document.getElementById('confirm').style.display='none'};
document.getElementById('yes').onclick=function(){if(pending&&o.callTool){o.callTool('team_update_member',pending);document.getElementById('confirm').textContent='Sent for saving.'}};
})();
</script></body></html>`;
}

// Roles each plan includes (Marshall). Mirrors mcp_team_plans in the migration; the database is what enforces it.
// Owner is always allowed. Super on PM and Office is OPEN for Marshall: disabled until added here and in mcp_team_plans.
export const PLAN_ROLES: Record<string, readonly TeamRole[]> = {
  circle: TEAM_ROLES,
  hardcore: TEAM_ROLES,
  athena_pm: ["owner", "pm"],
  athena_office: ["owner", "pm", "contracts", "estimating", "ap"],
};
export const SUPER_OPEN_FOR_MARSHALL = ["athena_pm", "athena_office"] as const;
export function planAllowsRole(tier: string | null | undefined, role: TeamRole): boolean {
  if (role === "owner") return true;
  const r = tier ? PLAN_ROLES[tier] : undefined;
  return r ? r.includes(role) : true;
}
