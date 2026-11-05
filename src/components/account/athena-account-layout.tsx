// Athena account page frame (Nov 2026 redesign, from the preview Marshall approved). Presentation only: every form,
// save and permission check lives in the section components and the database functions behind them.
// Desktop: sidebar + content. Tablet: header + tab row. Phone: one column.
import { useEffect, useState, type ReactNode } from "react";
import {
  Bell,
  Building2,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  CreditCard,
  ExternalLink,
  FolderOpen,
  LayoutGrid,
  Loader2,
  LogOut,
  ShieldCheck,
  Users,
  UserRound,
  Wallet,
} from "lucide-react";
import { companyInitials, type SetupStep } from "@/lib/account-profile";
import "./athena-account.css";

export type AccountSectionId =
  | "overview"
  | "company"
  | "team"
  | "payments"
  | "billing"
  | "projects"
  | "notices";
const sections = [
  { id: "overview", label: "Overview", Icon: LayoutGrid },
  { id: "company", label: "Company profile", Icon: Building2 },
  { id: "team", label: "Team & access", Icon: Users },
  { id: "payments", label: "Client payments", Icon: Wallet, soon: true },
  { id: "billing", label: "Plan & billing", Icon: CreditCard },
  { id: "projects", label: "Your projects", Icon: FolderOpen },
  { id: "notices", label: "Notifications", Icon: Bell },
] as const;
const copy: Record<AccountSectionId, { title: string; description: string }> = {
  overview: {
    title: "Your Athena account",
    description: "Your company, your people and your plan, in one place.",
  },
  company: {
    title: "Company profile",
    description:
      "This is what your clients see on pay apps, proposals, client pages and emails. Athena stays small in the corner.",
  },
  team: {
    title: "Team & access",
    description:
      "Invite your people, pick what each role can see, and choose which jobs they work on.",
  },
  payments: {
    title: "Client payments",
    description:
      "Let clients pay your invoices and pay apps by card or bank, straight from their client page.",
  },
  billing: {
    title: "Plan & billing",
    description: "Your Athena plan, your seats and your subscription.",
  },
  projects: {
    title: "Your projects",
    description: "Pick up where you left off. Open a saved project workspace.",
  },
  notices: {
    title: "Notifications",
    description: "What came back from clients, reviewers, subs and suppliers on every job.",
  },
};

export type AccountCompanyChoice = { id: string; name: string | null };

export type AthenaAccountLayoutProps = {
  name: string | null;
  email: string | null;
  companyName: string | null;
  companyLogoUrl?: string | null;
  /** Every company this person belongs to. The switcher shows only when there's more than one. */
  companies?: AccountCompanyChoice[];
  currentCompanyId?: string | null;
  onSwitchCompany?: (companyId: string) => void;
  organization?: { name: string | null; status: "loading" | "error" | "ready" };
  plan: string;
  seats: string;
  teamLoading: boolean;
  teamError: boolean;
  canViewSupport: boolean;
  onSignOut: () => Promise<void>;
  setup?: SetupStep[];
  profile: ReactNode;
  company: ReactNode;
  team: ReactNode;
  payments?: ReactNode;
  billing: ReactNode;
  projects: ReactNode;
  briefing: ReactNode;
  guide: ReactNode;
  /** Notices across every job. The section is left out when the page passes none. */
  notices?: ReactNode;
  /** Unread notices across every job, for the red count in the nav. */
  noticeCount?: number | null;
};

function isSection(v: string): v is AccountSectionId {
  return sections.some((s) => s.id === v);
}

function CompanyBadge({
  props,
  compact = false,
}: {
  props: AthenaAccountLayoutProps;
  compact?: boolean;
}) {
  const choices = props.companies ?? [];
  const canSwitch = choices.length > 1 && !!props.onSwitchCompany;
  return (
    <div className="aa-company">
      <span className="aa-company-logo" aria-hidden="true">
        {props.companyLogoUrl ? (
          <img src={props.companyLogoUrl} alt="" />
        ) : (
          companyInitials(props.companyName)
        )}
      </span>
      <div className="aa-company-text">
        <strong>{props.companyName || "Your company"}</strong>
        {!compact ? <small>{props.plan}</small> : null}
        {canSwitch && !compact ? (
          <select
            aria-label="Switch company"
            value={props.currentCompanyId ?? ""}
            onChange={(e) => props.onSwitchCompany?.(e.target.value)}
          >
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || "Unnamed company"}
              </option>
            ))}
          </select>
        ) : null}
      </div>
    </div>
  );
}

function SetupChecklist({
  steps,
  onOpen,
}: {
  steps: SetupStep[];
  onOpen: (id: AccountSectionId) => void;
}) {
  const counted = steps.filter((s) => !s.soon);
  const done = counted.filter((s) => s.done).length;
  return (
    <section className="aa-card aa-setup" aria-labelledby="aa-setup-title">
      <div className="aa-row">
        <div>
          <h2 id="aa-setup-title">Set up your company</h2>
          <p className="aa-lede">
            {done === counted.length
              ? "You're set up. Client payments are next when they open."
              : `${done} of ${counted.length} done. Each step takes a couple of minutes.`}
          </p>
        </div>
        <span className="aa-pill aa-pill-blue aa-num">
          {done} of {counted.length}
        </span>
      </div>
      <div className="aa-meter" aria-hidden="true">
        <span style={{ width: `${counted.length ? (done / counted.length) * 100 : 0}%` }} />
      </div>
      <ul className="aa-steps">
        {steps.map((s) => {
          const target = s.href.replace("#", "");
          return (
            <li key={s.id} className={s.done ? "aa-done" : undefined}>
              <span className="aa-tick" aria-hidden="true">
                {s.done ? <Check size={14} strokeWidth={3} /> : null}
              </span>
              <span className="aa-step-text">
                <strong>{s.label}</strong>
                <small>{s.detail}</small>
              </span>
              {s.soon ? (
                <span className="aa-pill aa-pill-violet">Coming soon</span>
              ) : s.done ? (
                <span className="aa-pill aa-pill-ok">Done</span>
              ) : (
                <a
                  className="aa-btn aa-btn-ghost aa-btn-sm"
                  href={s.href}
                  onClick={(e) => {
                    if (isSection(target)) {
                      e.preventDefault();
                      onOpen(target);
                    }
                  }}
                >
                  Start
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Athena presentation only. Account forms and every server permission stay with their existing owners. */
export function AthenaAccountLayout(props: AthenaAccountLayoutProps) {
  const [section, setSection] = useState<AccountSectionId>("overview");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  useEffect(() => {
    function syncSection() {
      const target = window.location.hash.slice(1);
      if (!target) setSection("overview");
      else if (isSection(target)) setSection(target);
      else if (target === "organization") setSection("company");
    }
    syncSection();
    window.addEventListener("hashchange", syncSection);
    return () => window.removeEventListener("hashchange", syncSection);
  }, []);
  function navigate(target: AccountSectionId) {
    setSection(target);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${target === "overview" ? "" : `#${target}`}`,
    );
    window.scrollTo?.({ top: 0 });
  }
  const current = copy[section];
  const initials = (props.name || props.email || "A")
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await props.onSignOut();
    } catch {
      setSignOutError("Could not sign out. Please try again.");
    } finally {
      setSigningOut(false);
    }
  }
  const shown = sections.filter((s) => s.id !== "notices" || props.notices !== undefined);
  const navLink = (id: AccountSectionId) => ({
    href: id === "overview" ? "/account" : `#${id}`,
    "aria-current": section === id ? ("page" as const) : undefined,
    onClick: (e: React.MouseEvent) => {
      e.preventDefault();
      navigate(id);
    },
  });
  const signOutButton = (
    <button
      type="button"
      className="aa-btn aa-btn-ghost aa-btn-sm"
      onClick={() => void signOut()}
      disabled={signingOut}
    >
      {signingOut ? <Loader2 size={14} className="aa-spin" /> : <LogOut size={14} />}
      <span className="aa-signout-label">{signingOut ? "Signing out…" : "Sign out"}</span>
    </button>
  );
  const firstName = props.name?.trim().split(/\s+/)[0];
  const companyTile =
    props.organization?.status === "loading"
      ? "Loading…"
      : props.organization?.status === "error"
        ? "Unavailable"
        : props.organization?.name || props.companyName || "Add your company";

  return (
    <div className="athena-account">
      <a className="aa-skip" href="#athena-account-content">
        Skip to account content
      </a>
      <aside className="aa-sidebar">
        <a className="aa-brand" href="/account" aria-label="Athena · My account">
          <img src="/brand/athena/athena-lockup-blue.svg" alt="Athena" />
        </a>
        <CompanyBadge props={props} />
        <p className="aa-nav-label">ACCOUNT</p>
        <nav aria-label="Account sections" className="aa-nav">
          {shown.map((s) => (
            <a key={s.id} {...navLink(s.id)}>
              <s.Icon size={18} aria-hidden="true" />
              <span>{s.label}</span>
              {"soon" in s && s.soon ? <span className="aa-tag">Soon</span> : null}
              {s.id === "notices" && props.noticeCount ? (
                <span className="aa-nav-count" aria-label={`${props.noticeCount} unread`}>
                  {props.noticeCount > 99 ? "99+" : props.noticeCount}
                </span>
              ) : null}
            </a>
          ))}
        </nav>
        {props.canViewSupport ? (
          <div className="aa-admin-slot">
            <span>
              <ShieldCheck size={14} />
              ADMINISTRATION
            </span>
            <a href="/admin/support">
              <CircleHelp size={17} />
              Support
              <ChevronRight size={14} />
            </a>
          </div>
        ) : null}
        <div className="aa-sidebar-bottom">
          <a href="https://meetathena.io/connect/" target="_blank" rel="noreferrer">
            Connect your chat
            <ExternalLink size={14} aria-hidden="true" />
          </a>
          <span className="aa-powered">ATHENA BY ALP</span>
        </div>
      </aside>
      <div className="aa-body">
        <header className="aa-topbar">
          <div className="aa-breadcrumb">
            My account <ChevronRight size={13} />
            <span>{sections.find((item) => item.id === section)?.label}</span>
          </div>
          <div className="aa-session">
            <span>{props.email}</span>
            <span className="aa-avatar" aria-hidden="true">
              {initials}
            </span>
            {signOutButton}
          </div>
        </header>
        <header className="aa-mobile-head">
          <a href="/account" aria-label="Athena · My account">
            <img src="/brand/athena/athena-lockup-blue.svg" alt="Athena" />
          </a>
          <div className="aa-mobile-right">
            <CompanyBadge props={props} compact />
            {signOutButton}
          </div>
        </header>
        <nav className="aa-tabs" aria-label="Account sections">
          {shown.map((s) => (
            <a key={s.id} {...navLink(s.id)}>
              {s.label}
            </a>
          ))}
        </nav>
        <main id="athena-account-content" className="aa-content">
          <div className="aa-page-heading">
            <p className="aa-eyebrow">MY ACCOUNT</p>
            <h1>
              {section === "overview" && firstName ? `Welcome back, ${firstName}` : current.title}
            </h1>
            <p>{current.description}</p>
          </div>
          {signOutError ? (
            <p role="alert" className="aa-error">
              {signOutError}
            </p>
          ) : null}
          {props.teamError ? (
            <p role="status" className="aa-notice">
              Plan and team details could not be loaded. Reload the page to try again.
            </p>
          ) : null}
          {(props.companies?.length ?? 0) > 1 && props.onSwitchCompany ? (
            <div className="aa-note aa-company-switch-mobile" hidden={section !== "overview"}>
              <label className="aa-field">
                <span className="aa-flabel">You belong to more than one company. Showing:</span>
                <select
                  value={props.currentCompanyId ?? ""}
                  onChange={(e) => props.onSwitchCompany?.(e.target.value)}
                >
                  {props.companies?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || "Unnamed company"}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}
          <div className="aa-view" hidden={section !== "overview"}>
            {props.setup?.length ? <SetupChecklist steps={props.setup} onOpen={navigate} /> : null}
            <div className="aa-grid3">
              <a className="aa-tile" {...navLink("company")}>
                <small>COMPANY</small>
                <strong>{companyTile}</strong>
                <em>Logo and details clients see</em>
              </a>
              <a className="aa-tile" {...navLink("team")}>
                <small>TEAM SEATS</small>
                <strong className="aa-num">
                  {props.teamLoading ? "Loading…" : props.teamError ? "Unavailable" : props.seats}
                </strong>
                <em>People, roles and job access</em>
              </a>
              <a className="aa-tile" {...navLink("billing")}>
                <small>PLAN</small>
                <strong>{props.teamError ? "Unavailable" : props.plan}</strong>
                <em>Plan, seats and invoices</em>
              </a>
            </div>
            <div className="aa-grid2">
              <section className="aa-card">
                <div className="aa-row">
                  <h2>
                    <UserRound size={17} aria-hidden="true" /> You
                  </h2>
                </div>
                {props.profile}
                <div className="aa-identity-note">
                  <ShieldCheck size={15} />
                  <p>
                    You sign in with this email and a code we send you. Use the same email when you
                    connect Athena to your chat.
                  </p>
                </div>
              </section>
              <section className="aa-card aa-brief-card">
                <div>
                  <p className="aa-eyebrow">STAY ONE STEP AHEAD</p>
                  <h2>Your morning briefing</h2>
                  <p className="aa-lede">A clear place to start your day.</p>
                </div>
                {props.briefing}
              </section>
            </div>
            <details className="aa-guide">
              <summary>
                New to Athena? Start here
                <ChevronDown size={17} className="aa-guide-chevron" aria-hidden="true" />
              </summary>
              {props.guide}
            </details>
          </div>
          <section className="aa-view" hidden={section !== "company"} aria-label="Company profile">
            {props.company}
          </section>
          <section className="aa-view" hidden={section !== "team"} aria-label="Team and access">
            {props.team}
          </section>
          <section className="aa-view" hidden={section !== "payments"} aria-label="Client payments">
            {props.payments}
          </section>
          <section className="aa-view" hidden={section !== "billing"} aria-label="Plan and billing">
            {props.billing}
          </section>
          <section
            className="aa-view aa-projects"
            hidden={section !== "projects"}
            aria-label="Saved projects"
          >
            {props.projects}
          </section>
          {props.notices !== undefined ? (
            <section
              className="aa-view aa-notices-wrap"
              hidden={section !== "notices"}
              aria-label="Notifications"
            >
              {props.notices}
            </section>
          ) : null}
          <footer className="aa-footer">
            <span>Built for the people who build.</span>
            <span>Athena by ALP</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
