import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
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
} from "lucide-react";
import "./athena-account.css";

type Section = "overview" | "company" | "team" | "billing" | "projects";
const sections = [
  { id: "overview", label: "Overview", Icon: LayoutGrid },
  { id: "company", label: "Company profile", Icon: Building2 },
  { id: "team", label: "Team & access", Icon: Users },
  { id: "billing", label: "Plan & billing", Icon: CreditCard },
  { id: "projects", label: "Your projects", Icon: FolderOpen },
] as const;
const copy: Record<Section, { title: string; description: string }> = {
  overview: {
    title: "Your Athena account",
    description: "Your workspace, your people, and everything you need to keep moving.",
  },
  company: {
    title: "Company profile",
    description: "Keep your company identity and workspace details up to date.",
  },
  team: {
    title: "Team & access",
    description: "The right people. The right roles. Access to the jobs they need.",
  },
  billing: {
    title: "Plan & billing",
    description: "Your current plan, seats, and subscription details in one place.",
  },
  projects: {
    title: "Your projects",
    description: "Pick up where you left off. Open a saved project workspace.",
  },
};

export type AthenaAccountLayoutProps = {
  name: string | null;
  email: string | null;
  companyName: string | null;
  plan: string;
  seats: string;
  teamLoading: boolean;
  teamError: boolean;
  canViewSupport: boolean;
  onSignOut: () => Promise<void>;
  profile: ReactNode;
  company: ReactNode;
  team: ReactNode;
  billing: ReactNode;
  projects: ReactNode;
  briefing: ReactNode;
  guide: ReactNode;
};

/** Athena presentation only. Account forms and every server permission stay with their existing owners. */
export function AthenaAccountLayout(props: AthenaAccountLayoutProps) {
  const [section, setSection] = useState<Section>("overview");
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  useEffect(() => {
    function syncSection() {
      const target = window.location.hash.slice(1);
      if (!target) setSection("overview");
      else if (sections.some((item) => item.id === target)) setSection(target as Section);
    }
    syncSection();
    window.addEventListener("hashchange", syncSection);
    return () => window.removeEventListener("hashchange", syncSection);
  }, []);
  function navigate(target: Section) {
    setSection(target);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#${target}`,
    );
  }
  const current = copy[section];
  const initials = (props.name || props.email || "A")
    .split(/[\s@]+/)
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
  return (
    <div className="athena-account">
      <a className="aa-skip" href="#athena-account-content">
        Skip to account content
      </a>
      <aside className="aa-sidebar">
        <a className="aa-brand" href="/account" aria-label="Athena · My account">
          <img src="/brand/athena/athena-lockup-blue.svg" alt="Athena" />
        </a>
        <div className="aa-workspace">
          <span className="aa-workspace-icon">
            <Building2 size={18} />
          </span>
          <div>
            <strong>{props.companyName || "Your workspace"}</strong>
            <span>Athena workspace</span>
          </div>
        </div>
        <p className="aa-eyebrow aa-nav-label">Account</p>
        <nav aria-label="Account sections" className="aa-nav">
          {sections.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-current={section === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {section === id ? <ChevronRight size={16} /> : null}
            </button>
          ))}
        </nav>
        {props.canViewSupport ? (
          <div className="aa-admin-slot">
            <span>
              <ShieldCheck size={16} />
              Administration
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
            <ExternalLink size={17} aria-hidden="true" />
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
            <span className="aa-session-label">Signed in</span>
            <span className="aa-avatar" aria-hidden="true">
              {initials}
            </span>
            <button type="button" onClick={() => void signOut()} disabled={signingOut}>
              {signingOut ? <Loader2 size={15} className="aa-spin" /> : <LogOut size={15} />}
              <span>{signingOut ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </header>
        <main id="athena-account-content" className="aa-content">
          <div className="aa-page-heading">
            <p className="aa-eyebrow">MY ACCOUNT</p>
            <h1>{current.title}</h1>
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
          <div hidden={section !== "overview"}>
            <section className="aa-welcome">
              <div>
                <span className="aa-welcome-tag">
                  <span />
                  YOUR WORKSPACE
                </span>
                <h2>Good to have you here{props.name ? `, ${props.name.split(" ")[0]}` : ""}.</h2>
                <p>
                  Less time keeping track.
                  <br />
                  More time moving the job forward.
                </p>
                <button type="button" onClick={() => navigate("projects")}>
                  Go to your projects
                  <ArrowRight size={17} />
                </button>
              </div>
              <div className="aa-welcome-art" aria-hidden="true">
                <div className="aa-art-grid" />
                <div className="aa-art-sheet">
                  <span />
                  <span />
                  <span />
                  <div>
                    <ShieldCheck size={23} />
                    <strong>One clear next step.</strong>
                  </div>
                </div>
                <img src="/brand/athena/athena-mark-mono-blue.svg" alt="" />
              </div>
            </section>
            <div className="aa-summary-grid">
              <button type="button" onClick={() => navigate("company")}>
                <span className="aa-summary-icon">
                  <Building2 size={20} />
                </span>
                <span>
                  <small>YOUR COMPANY</small>
                  <strong>{props.companyName || "Set up your company"}</strong>
                  <em>Manage company profile</em>
                </span>
                <ChevronRight size={18} />
              </button>
              <button type="button" onClick={() => navigate("team")}>
                <span className="aa-summary-icon">
                  <Users size={20} />
                </span>
                <span>
                  <small>TEAM SEATS</small>
                  <strong>
                    {props.teamLoading ? "Loading…" : props.teamError ? "Unavailable" : props.seats}
                  </strong>
                  <em>View people & permissions</em>
                </span>
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="aa-overview-grid">
              <section className="aa-identity aa-card">
                <div className="aa-card-title">
                  <UserRound size={19} />
                  <h2>Personal details</h2>
                </div>
                {props.profile}
                <div className="aa-identity-note">
                  <ShieldCheck size={15} />
                  <p>
                    You’re signed in with this email. Use the same account when connecting Athena to
                    your chat.
                  </p>
                </div>
              </section>
              <section className="aa-plan-summary aa-card">
                <div className="aa-card-title">
                  <CreditCard size={19} />
                  <h2>Your plan</h2>
                </div>
                <p className="aa-plan-name">{props.teamError ? "Plan unavailable" : props.plan}</p>
                <p>Manage the subscription and seats associated with your Athena access.</p>
                <button
                  type="button"
                  className="aa-text-action"
                  onClick={() => navigate("billing")}
                >
                  View plan & billing
                  <ArrowRight size={16} />
                </button>
              </section>
            </div>
            <section className="aa-brief-card aa-card">
              <div>
                <p className="aa-eyebrow">STAY ONE STEP AHEAD</p>
                <h2>Your morning briefing</h2>
                <p>A clear place to start your day.</p>
              </div>
              {props.briefing}
            </section>
            <details className="aa-guide">
              <summary>
                New to Athena? Start here
                <ChevronDown size={17} className="aa-guide-chevron" aria-hidden="true" />
              </summary>
              {props.guide}
            </details>
          </div>
          <section
            className="aa-existing"
            hidden={section !== "company"}
            aria-label="Company settings"
          >
            {props.company}
          </section>
          <section className="aa-existing" hidden={section !== "team"} aria-label="Team settings">
            {props.team}
          </section>
          <section
            className="aa-existing"
            hidden={section !== "billing"}
            aria-label="Billing settings"
          >
            {props.billing}
          </section>
          <section
            className="aa-projects"
            hidden={section !== "projects"}
            aria-label="Saved projects"
          >
            {props.projects}
          </section>
          <footer className="aa-footer">
            <span>Built for the people who build.</span>
            <span>Athena by ALP</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
