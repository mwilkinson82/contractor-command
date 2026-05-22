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
  ArrowUpCircle,
  Flame,
  Lock,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useTier, type Tier } from "@/hooks/use-tier";
import { nextAny, relativeDay } from "@/lib/program";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";
import { TierImpersonator } from "@/components/portal/tier-impersonator";

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
    } catch {}
  }, []);

  useEffect(() => {
    if (userPrefRef.current === null) return;
    if (pathname === "/handbook") {
      setCollapsed(true);
    } else {
      setCollapsed(userPrefRef.current);
    }
    // Close mobile drawer on route change
    setMobileOpen(false);
  }, [pathname]);

  function toggle() {
    setCollapsed((c) => {
      const n = !c;
      userPrefRef.current = n;
      try { window.localStorage.setItem(STORAGE, n ? "1" : "0"); } catch {}
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

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; match?: string };
type Group = { label: string; items: Item[] };

// Full nav for Circle members.
const CIRCLE_GROUPS: Group[] = [
  {
    label: "Daily",
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/ask", label: "Ask Marshall", icon: Megaphone, match: "/ask" },
      { to: "/aos", label: "AOS", icon: Compass },
      { to: "/calls", label: "Calls", icon: Radio },
      { to: "/community", label: "Community", icon: MessagesSquare },
    ],
  },
  {
    label: "Library",
    items: [
      { to: "/handbook", label: "Handbook", icon: BookOpen },
      { to: "/templates", label: "Templates", icon: FileText },
      { to: "/replays", label: "Replays", icon: Video },
    ],
  },
  {
    label: "Command",
    items: [
      { to: "/tools", label: "Tools", icon: Wrench, match: "/tools" },
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

// Book Buyer: Handbook + AOS + Ask Marshall (15/day cap), with Upgrade as
// the obvious next step. No replays, no templates, no calls.
const BOOK_BUYER_GROUPS: Group[] = [
  {
    label: "Your tools",
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/handbook", label: "Handbook", icon: BookOpen },
      { to: "/aos", label: "AOS", icon: Compass },
      { to: "/ask", label: "Ask Marshall", icon: Megaphone, match: "/ask" },
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

// Intensive grad: Book Buyer + program access (intensive materials live at
// /work-with-marshall today).
const INTENSIVE_GROUPS: Group[] = [
  {
    label: "Your tools",
    items: [
      { to: "/", label: "Home", icon: Home },
      { to: "/handbook", label: "Handbook", icon: BookOpen },
      { to: "/aos", label: "AOS", icon: Compass },
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
      { to: "/aos", label: "AOS", icon: Compass },
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
  const brandName = company?.name?.trim() || "Contractor Circle";
  const brandInitial = brandName.charAt(0).toUpperCase();
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
        className={`group/sidebar fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border/70 bg-[var(--paper-deep)] transition-[width,transform] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0`}
        style={{ width: collapsed ? "60px" : "216px" }}
      >
        <div className="flex h-14 items-center gap-2 border-b border-border/70 px-3">
          <Link to="/" className="flex items-center gap-2 overflow-hidden">
            <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-ink text-cream font-display text-[13px]">
              {logoUrl ? (
                <img src={logoUrl} alt={brandName} className="h-full w-full object-cover object-center" />
              ) : (
                brandInitial
              )}
            </span>
            {!collapsed && (
              <span className="flex flex-col leading-tight">
                <span className="truncate font-display text-[13px] tracking-tight" title={brandName}>{brandName}</span>
                <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Command Center</span>
              </span>
            )}
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {groups.map((g) => {
            const isTease = false;
            return (
            <div key={g.label} className="mb-4">
              {!collapsed && (
                <p className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: isTease ? "color-mix(in oklab, var(--foreground) 35%, transparent)" : "color-mix(in oklab, var(--signal) 75%, transparent)" }}>
                  {g.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {g.items.map((it) => {
                  const active = it.match ? pathname.startsWith(it.match) : pathname === it.to;
                  const Icon = it.icon;
                  return (
                    <li key={it.to}>
                      <Link
                        to={it.to as "/"}
                        title={collapsed ? (isTease ? `${it.label} — upgrade to unlock` : it.label) : (isTease ? "Daily Power Hour, S&M School, Contractor School. Upgrade to unlock." : undefined)}
                        className={`group/item relative flex items-center gap-3 rounded-md px-2 py-2 text-[13px] transition-colors ${
                          active
                            ? "bg-ink text-cream"
                            : isTease
                            ? "text-foreground/35 hover:bg-foreground/5 hover:text-foreground/60"
                            : "text-foreground/75 hover:bg-foreground/5 hover:text-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="truncate">{it.label}</span>}
                        {active && !collapsed && (
                          <span className="ml-auto h-1 w-1 rounded-full bg-signal" />
                        )}
                      </Link>
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
              <span className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-signal animate-signal-pulse" />
              <div className="min-w-0">
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Next session</p>
                <p className="mt-0.5 truncate text-[11px] text-foreground/80">
                  {next.kind} · {relativeDay(next.date)}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid place-items-center py-2" title={`${next.kind} · ${relativeDay(next.date)}`}>
              <Circle className="h-2 w-2 fill-signal text-signal animate-signal-pulse" />
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
      className="min-h-screen transition-[padding] duration-300 ease-[cubic-bezier(.2,.7,.2,1)] md:!pl-[var(--sb-w)]"
      style={
        {
          ["--sb-w" as string]: collapsed ? "60px" : "216px",
          paddingLeft: 0,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
