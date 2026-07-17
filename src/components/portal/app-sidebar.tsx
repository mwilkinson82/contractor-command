import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  Home,
  Video,
  Radio,
  MessagesSquare,
  FileText,
  Wrench,
  Compass,
  Archive,
  Sparkles,
  User,
  PanelLeftClose,
  PanelLeft,
  Circle,
  LogOut,
  Megaphone,
  Inbox,
  Library,
  Gauge,
  BookOpen,
  Map,
  ArrowUpCircle,
  Flame,
  Lock,
  ShieldCheck,
  Eye,
  CirclePlay,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { tierAtLeast, useTier, type Tier } from "@/hooks/use-tier";
import { nextAny, relativeDay } from "@/lib/program";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { TierImpersonator } from "@/components/portal/tier-impersonator";
import { ContractorCircleBrand } from "@/components/brand/contractor-circle-brand";

type Ctx = {
  collapsed: boolean;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  toggleMobile: () => void;
};
const SidebarCtx = createContext<Ctx>({
  collapsed: false,
  toggle: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
  toggleMobile: () => {},
});
export const useAppSidebar = () => useContext(SidebarCtx);

const STORAGE = "alp.cc.sidebar.collapsed";

export function AppSidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const userPrefRef = useRef<boolean | null>(null);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE);
      const initial = v === "1";
      userPrefRef.current = initial;
      setCollapsed(initial);
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }, []);

  useEffect(() => {
    if (userPrefRef.current === null) return;
    if (pathname === "/handbook" || pathname === "/operating-playbook") {
      setCollapsed(true);
    } else {
      setCollapsed(userPrefRef.current);
    }
    // Close mobile drawer on route change
    setMobileOpen(false);
  }, [pathname]);

  // Publish the desktop sidebar width as a global CSS var so that
  // viewport-fixed overlays (scheduler dock, drawers, full-screen modes)
  // can leave room for the left rail and never overlap its content.
  useEffect(() => {
    if (typeof document === "undefined") return;
    // Floating rail: 12px left margin + panel width + 12px gap before content.
    const w = collapsed ? "84px" : "240px";
    document.documentElement.style.setProperty("--app-sidebar-w", w);
    // On mobile the rail is off-canvas; overlays should use 0.
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => {
      document.documentElement.style.setProperty("--app-sidebar-w", mq.matches ? "0px" : w);
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [collapsed]);

  function toggle() {
    setCollapsed((c) => {
      const n = !c;
      userPrefRef.current = n;
      try {
        window.localStorage.setItem(STORAGE, n ? "1" : "0");
      } catch {
        // Storage can be unavailable in private or restricted browser contexts.
      }
      return n;
    });
  }
  function toggleMobile() {
    setMobileOpen((v) => !v);
  }
  return (
    <SidebarCtx.Provider value={{ collapsed, toggle, mobileOpen, setMobileOpen, toggleMobile }}>
      {children}
    </SidebarCtx.Provider>
  );
}

type Item = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  match?: string | readonly string[];
  exact?: boolean;
  external?: boolean;
  minTier?: Tier;
};
type Group = { label: string; items: Item[] };

function isItemActive(item: Item, pathname: string) {
  if (item.external) return false;
  if (item.exact) return pathname === item.to;
  if (typeof item.match === "string") return pathname.startsWith(item.match);
  if (item.match) return item.match.some((prefix) => pathname.startsWith(prefix));
  return pathname === item.to;
}

// Full nav for Circle members.
const CIRCLE_GROUPS: Group[] = [
  {
    label: "Daily",
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/start-here", label: "Start Here", icon: CirclePlay },
      { to: "/ecosystem", label: "ALP Ecosystem", icon: Map },
      {
        to: "/operating-playbook",
        label: "Contractor OS",
        icon: FileText,
        minTier: "circle",
      },
      {
        to: "/tools/cos-navigator",
        label: "State of Control",
        icon: Gauge,
        match: ["/tools/cos-navigator", "/control-plan"],
      },
      { to: "/ask", label: "Ask Marshall", icon: Megaphone, match: "/ask" },
      { to: "/aos", label: "AOS", icon: Compass },
      { to: "/overwatch", label: "Overwatch", icon: ShieldCheck },
      { to: "/calls", label: "Calls", icon: Radio, minTier: "circle" },
      { to: "/community", label: "Community", icon: MessagesSquare, minTier: "circle" },
    ],
  },
  {
    label: "Library",
    items: [
      { to: "/handbook", label: "Handbook", icon: BookOpen },
      { to: "/templates", label: "Templates", icon: FileText, minTier: "circle" },
      { to: "/replays", label: "Replays", icon: Video, minTier: "circle" },
    ],
  },
  {
    label: "Command",
    items: [
      { to: "/tools", label: "Tools", icon: Wrench, exact: true },
      { to: "/vault", label: "Vault", icon: Archive },
    ],
  },
  {
    label: "Program",
    items: [
      { to: "/work-with-marshall", label: "Work with Marshall", icon: Sparkles },
      { to: "/upgrade", label: "Add-ons", icon: ArrowUpCircle },
      { to: "/account", label: "Account", icon: User },
    ],
  },
];

// Tease group: shown to every non-hardcore tier so they can see Hardcore exists.
const HARDCORE_TEASE: Group = {
  label: "Hardcore",
  items: [{ to: "/upgrade", label: "Hardcore Room", icon: Lock, match: "__never__" }],
};

// Real hardcore group: only for tier=hardcore + admin.
const HARDCORE_REAL: Group = {
  label: "Hardcore",
  items: [{ to: "/hardcore", label: "Hardcore Room", icon: Flame }],
};

// Book Buyer (ALP Handbook tier): show the complete ecosystem. Included
// surfaces are live; Contractor Circle surfaces stay visible as locked previews.
const BOOK_BUYER_GROUPS: Group[] = [
  {
    label: "Daily",
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/start-here", label: "Start Here", icon: CirclePlay },
      { to: "/ecosystem", label: "ALP Ecosystem", icon: Map },
      {
        to: "/operating-playbook",
        label: "Contractor OS",
        icon: FileText,
        minTier: "circle",
      },
      {
        to: "/tools/cos-navigator",
        label: "State of Control",
        icon: Gauge,
        match: ["/tools/cos-navigator", "/control-plan"],
      },
      { to: "/aos", label: "AOS", icon: Compass },
      { to: "/overwatch", label: "OverWatch Free", icon: Eye },
      { to: "/ask", label: "Ask Marshall", icon: Megaphone, match: "/ask" },
      { to: "/calls", label: "Calls", icon: Radio, minTier: "circle" },
      { to: "/community", label: "Community", icon: MessagesSquare, minTier: "circle" },
    ],
  },
  {
    label: "Library",
    items: [
      { to: "/handbook", label: "Handbook", icon: BookOpen },
      { to: "/templates", label: "Templates", icon: FileText, minTier: "circle" },
      { to: "/replays", label: "Replays", icon: Video, minTier: "circle" },
    ],
  },
  {
    label: "Command",
    items: [
      { to: "/tools", label: "Tools", icon: Wrench, exact: true },
      { to: "/vault", label: "Vault", icon: Archive },
    ],
  },
  {
    label: "Go further",
    items: [
      { to: "/work-with-marshall", label: "Work with Marshall", icon: Sparkles },
      { to: "/upgrade", label: "Upgrade", icon: ArrowUpCircle },
      { to: "/account", label: "Account", icon: User },
    ],
  },
];

// Intensive grad: Book Buyer + program access (intensive materials live at
// /work-with-marshall today).
const INTENSIVE_GROUPS: Group[] = [
  {
    label: "Your tools",
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/start-here", label: "Start Here", icon: CirclePlay },
      { to: "/ecosystem", label: "ALP Ecosystem", icon: Map },
      { to: "/handbook", label: "Handbook", icon: BookOpen },
      {
        to: "/tools/cos-navigator",
        label: "State of Control",
        icon: Gauge,
        match: ["/tools/cos-navigator", "/control-plan"],
      },
      { to: "/aos", label: "AOS", icon: Compass },
      { to: "https://overwatch.alpcontractorcircle.com", label: "IOR", icon: Eye, external: true },
      { to: "/calls", label: "Calls", icon: Radio, minTier: "circle" },
      { to: "/templates", label: "Templates", icon: FileText, minTier: "circle" },
      { to: "/replays", label: "Replays", icon: Video, minTier: "circle" },
    ],
  },
  {
    label: "Program",
    items: [
      { to: "/work-with-marshall", label: "Work with Marshall", icon: Sparkles },
      { to: "/upgrade", label: "Join the Circle", icon: ArrowUpCircle },
      { to: "/account", label: "Account", icon: User },
    ],
  },
];

// AOS-only buyer: AOS gateway + upgrade path. No handbook, no Circle rooms.
const AOS_ONLY_GROUPS: Group[] = [
  {
    label: "Your tools",
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/ecosystem", label: "ALP Ecosystem", icon: Map },
      { to: "/aos", label: "AOS", icon: Compass },
      { to: "https://overwatch.alpcontractorcircle.com", label: "IOR", icon: Eye, external: true },
    ],
  },
  {
    label: "Go further",
    items: [
      { to: "/upgrade", label: "Upgrade", icon: ArrowUpCircle },
      { to: "/account", label: "Account", icon: User },
    ],
  },
];

function groupsForTier(tier: Tier | null): Group[] {
  switch (tier) {
    case "aos_only":
      return AOS_ONLY_GROUPS;
    case "book_buyer":
      return BOOK_BUYER_GROUPS;
    case "intensive":
      return INTENSIVE_GROUPS;
    case "power_hour":
    case "sm_school":
    case "contractor_school":
    case "hardcore":
    case "circle":
    default:
      // Full nav — these all pay the same as Circle and get everything.
      return CIRCLE_GROUPS;
  }
}

export function AppSidebar() {
  const { collapsed, toggle, mobileOpen, setMobileOpen } = useAppSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const next = nextAny();
  const { company, logoUrl } = useCompany();
  const companyName = company?.name?.trim() || "Your company";
  const companyInitial = companyName.charAt(0).toUpperCase();
  const isAdmin = useIsAdmin();
  const { tier } = useTier();

  const baseGroups = groupsForTier(tier);
  // Hardcore nav is hidden for now while we figure out the page direction.
  const groups: Group[] = isAdmin
    ? [
        ...CIRCLE_GROUPS,
        {
          label: "Admin",
          items: [
            { to: "/admin", label: "Dashboard", icon: Gauge },
            {
              to: "/admin/control",
              label: "Member Control",
              icon: ShieldCheck,
              match: "/admin/control",
            },
            { to: "/admin/topics", label: "Topics", icon: Inbox, match: "/admin/topics" },
            { to: "/admin/library", label: "Library", icon: Library, match: "/admin/library" },
          ],
        },
      ]
    : baseGroups;

  const wasOnAsk = useRef(false);
  useEffect(() => {
    const onAsk = pathname.startsWith("/ask");
    if (onAsk && !wasOnAsk.current && !collapsed) toggle();
    wasOnAsk.current = onAsk;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/login" });
  }

  return (
    <>
      {/* Mobile backdrop */}
      <div
        onClick={() => setMobileOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />
      <aside
        data-collapsed={collapsed || undefined}
        data-mobile-open={mobileOpen || undefined}
        className={`ink-rail group/sidebar fixed inset-y-0 left-0 z-50 flex flex-col bg-ink-panel text-foreground shadow-[0_20px_44px_-24px_rgb(18_13_8/0.5)] transition-[width,transform] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] md:inset-y-3 md:left-3 md:rounded-[20px] md:shadow-[0_24px_50px_-24px_rgb(18_13_8/0.55),inset_0_1px_0_rgb(255_255_255/0.06)] ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
        style={{ width: collapsed ? "60px" : "216px" }}
      >
        <div className="border-b border-border/70 px-3 py-2.5">
          <Link
            to="/"
            aria-label="Contractor Circle Command Center"
            className="block overflow-hidden"
          >
            <ContractorCircleBrand inverse compact={collapsed} markClassName="h-9 w-9" />
          </Link>

          {!collapsed && (
            <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-cream/10 bg-cream/[0.045] px-2 py-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md bg-cream text-ink font-display text-[11px]">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={`${companyName} logo`}
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  companyInitial
                )}
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-[7px] font-semibold uppercase tracking-[0.2em] text-cream/40">
                  Workspace
                </span>
                <span className="block truncate text-[11px] text-cream/80" title={companyName}>
                  {companyName}
                </span>
              </span>
            </div>
          )}
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {groups.map((g) => {
            const isTease = false;
            return (
              <div key={g.label} className="mb-4">
                {!collapsed && (
                  <p
                    className="eyebrow px-2 pb-1.5"
                    style={
                      isTease
                        ? { color: "color-mix(in oklab, var(--foreground) 35%, transparent)" }
                        : undefined
                    }
                  >
                    {g.label}
                  </p>
                )}
                <ul className="space-y-0.5">
                  {g.items.map((it) => {
                    const active = isItemActive(it, pathname);
                    const locked = Boolean(it.minTier && !tierAtLeast(tier, it.minTier));
                    const Icon = it.icon;
                    const className = `group/item relative flex items-center gap-3 rounded-md px-2 py-2 text-[13px] transition-colors ${
                      active
                        ? "bg-clay/[0.18] text-foreground"
                        : locked || isTease
                          ? "text-foreground/35 hover:bg-foreground/5 hover:text-foreground/60"
                          : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
                    }`;
                    const titleAttr = collapsed
                      ? locked
                        ? `${it.label} — available to Contractor Circle members`
                        : isTease
                          ? `${it.label} — upgrade to unlock`
                          : it.label
                      : locked
                        ? `${it.label} — available to Contractor Circle members`
                        : isTease
                          ? "Daily Power Hour, S&M School, Contractor School. Upgrade to unlock."
                          : undefined;
                    const inner = (
                      <>
                        <Icon className={`h-4 w-4 shrink-0 ${active ? "text-clay" : ""}`} />
                        {!collapsed && (
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{it.label}</span>
                            {locked && (
                              <span className="mt-0.5 block truncate font-mono text-[7px] uppercase tracking-[0.16em] text-clay/75">
                                Contractor Circle
                              </span>
                            )}
                          </span>
                        )}
                        {locked && <Lock className="h-3 w-3 shrink-0 text-clay/75" />}
                      </>
                    );
                    return (
                      <li key={it.to}>
                        {it.external ? (
                          <a
                            href={it.to}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={titleAttr}
                            className={className}
                          >
                            {inner}
                          </a>
                        ) : (
                          <Link to={it.to as "/"} title={titleAttr} className={className}>
                            {inner}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-border/70 p-2 space-y-2">
          {isAdmin && <TierImpersonator collapsed={collapsed} />}
          {!collapsed ? (
            <div className="flex items-start gap-2 rounded-md bg-foreground/[0.03] px-2.5 py-2">
              <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-good text-good animate-live-pulse" />
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">
                  Next session
                </p>
                <p className="mt-0.5 truncate text-[11px] text-foreground/80">
                  {next.kind} · {relativeDay(next.date)}
                </p>
              </div>
            </div>
          ) : (
            <div
              className="grid place-items-center py-2"
              title={`${next.kind} · ${relativeDay(next.date)}`}
            >
              <Circle className="h-2 w-2 fill-good text-good animate-live-pulse" />
            </div>
          )}
          {collapsed && (
            <button
              onClick={toggle}
              className="mt-2 hidden md:flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <PanelLeft className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={handleSignOut}
            title={collapsed ? "Sign out" : undefined}
            className={`mt-1 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground ${collapsed ? "justify-center" : "justify-start"}`}
          >
            <LogOut className="h-3.5 w-3.5" />
            {!collapsed && <span>Sign out</span>}
          </button>
        </div>
      </aside>
    </>
  );
}

export function SidebarInset({ children }: { children: ReactNode }) {
  const { collapsed } = useAppSidebar();
  return (
    <div
      className="min-h-screen min-w-0 w-full max-w-full overflow-x-clip transition-[padding] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] md:!pl-[var(--sb-w)]"
      style={
        {
          ["--sb-w" as string]: collapsed ? "84px" : "240px",
          paddingLeft: 0,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
