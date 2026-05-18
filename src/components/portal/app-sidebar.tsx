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
  Hammer,
  PanelLeftClose,
  PanelLeft,
  Circle,
  LogOut,
  Megaphone,
  Inbox,
  Library,
} from "lucide-react";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { nextAny, relativeDay } from "@/lib/program";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/hooks/use-company";

type Ctx = { collapsed: boolean; toggle: () => void };
const SidebarCtx = createContext<Ctx>({ collapsed: false, toggle: () => {} });
export const useAppSidebar = () => useContext(SidebarCtx);

const STORAGE = "alp.cc.sidebar.collapsed";

export function AppSidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  // Persist after mount (avoid SSR mismatch)
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(STORAGE);
      if (v === "1") setCollapsed(true);
    } catch {}
  }, []);
  function toggle() {
    setCollapsed((c) => {
      const n = !c;
      try { window.localStorage.setItem(STORAGE, n ? "1" : "0"); } catch {}
      return n;
    });
  }
  return <SidebarCtx.Provider value={{ collapsed, toggle }}>{children}</SidebarCtx.Provider>;
}

type Item = { to: string; label: string; icon: React.ComponentType<{ className?: string }>; match?: string };
type Group = { label: string; items: Item[] };

const GROUPS: Group[] = [
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
    label: "Build",
    items: [
      { to: "/field-tools", label: "Field", icon: Hammer },
    ],
  },
  {
    label: "Program",
    items: [
      { to: "/work-with-marshall", label: "Intensive", icon: Sparkles },
      { to: "/account", label: "Account", icon: User },
    ],
  },
];

export function AppSidebar() {
  const { collapsed, toggle } = useAppSidebar();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const next = nextAny();
  const { company, logoUrl } = useCompany();
  const brandName = company?.name?.trim() || "Contractor Circle";
  const brandInitial = brandName.charAt(0).toUpperCase();
  const isAdmin = useIsAdmin();

  const groups: Group[] = isAdmin
    ? [
        ...GROUPS,
        {
          label: "Admin",
          items: [
            { to: "/admin/topics", label: "Topics", icon: Inbox, match: "/admin/topics" },
            { to: "/admin/library", label: "Library", icon: Library, match: "/admin/library" },
          ],
        },
      ]
    : GROUPS;


  // Auto-collapse when entering Ask Marshall; only once per entry so the user
  // can still re-expand manually while on the page.
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
    <aside
      data-collapsed={collapsed || undefined}
      className="group/sidebar fixed inset-y-0 left-0 z-30 flex flex-col border-r border-border/70 bg-[var(--paper-deep)] transition-[width] duration-300 ease-[cubic-bezier(.2,.7,.2,1)]"
      style={{ width: collapsed ? "60px" : "248px" }}
    >
      {/* Brand — company logo + name (falls back to Circle lockup) */}
      <div className="flex h-14 items-center gap-2 border-b border-border/70 px-3">
        <Link to="/" className="flex items-center gap-2 overflow-hidden">
          <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-ink text-cream font-display text-[13px]">
            {logoUrl ? (
              <img src={logoUrl} alt={brandName} className="h-full w-full object-contain" />
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

      {/* Groups */}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {GROUPS.map((g) => (
          <div key={g.label} className="mb-4">
            {!collapsed && (
              <p className="px-2 pb-1.5 text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: "color-mix(in oklab, var(--signal) 75%, transparent)" }}>
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
                      title={collapsed ? it.label : undefined}
                      className={`group/item relative flex items-center gap-3 rounded-md px-2 py-2 text-[13px] transition-colors ${
                        active
                          ? "bg-ink text-cream"
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
        ))}
      </nav>

      {/* Footer status */}
      <div className="border-t border-border/70 p-2">
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
        <button
          onClick={toggle}
          className={`mt-2 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-foreground/5 hover:text-foreground ${collapsed ? "justify-center" : "justify-start"}`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeft className="h-3.5 w-3.5" /> : (
            <>
              <PanelLeftClose className="h-3.5 w-3.5" />
              <span>Collapse</span>
            </>
          )}
        </button>
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
  );
}

export function SidebarInset({ children }: { children: ReactNode }) {
  const { collapsed } = useAppSidebar();
  return (
    <div
      className="min-h-screen transition-[padding] duration-300 ease-[cubic-bezier(.2,.7,.2,1)]"
      style={{ paddingLeft: collapsed ? "60px" : "248px" }}
    >
      {children}
    </div>
  );
}
